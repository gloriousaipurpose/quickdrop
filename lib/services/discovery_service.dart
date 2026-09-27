import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import '../models/device_info.dart';
import 'network_utils.dart';

class DiscoveryService extends ChangeNotifier {
  static const int udpPort = 41234;
  RawDatagramSocket? _socket;
  Timer? _broadcastTimer;
  Timer? _cleanupTimer;

  final Map<String, DeviceInfo> _discoveredDevices = {};
  List<DeviceInfo> get discoveredDevices => _discoveredDevices.values.toList();

  bool _isAdvertising = false;
  bool get isAdvertising => _isAdvertising;

  bool _isScanning = false;
  bool get isScanning => _isScanning;

  String? _myDeviceId;
  String? _myDeviceName;
  String? _myIp;
  int _receiverPort = 8080;

  /// Start advertising this device on the local network (used by Windows Receiver)
  Future<void> startAdvertising({int receiverPort = 8080}) async {
    _receiverPort = receiverPort;
    _myDeviceName = await NetworkUtils.getDeviceName();
    _myIp = await NetworkUtils.getLocalIpAddress();
    _myDeviceId = '${_myDeviceName}_${_myIp ?? "device"}';

    if (_myIp == null) {
      print('DiscoveryService: Could not determine local IP address.');
    }

    try {
      _socket = await RawDatagramSocket.bind(
        InternetAddress.anyIPv4,
        udpPort,
        reuseAddress: true,
        reusePort: false,
      );
      _socket?.broadcastEnabled = true;
      _isAdvertising = true;
      notifyListeners();

      print('DiscoveryService: Listening & Advertising on UDP port $udpPort as $_myDeviceName ($_myIp)');

      // Listen for incoming PINGs or scan queries
      _socket?.listen((RawSocketEvent event) {
        if (event == RawSocketEvent.read) {
          final datagram = _socket?.receive();
          if (datagram != null) {
            _handleIncomingDatagram(datagram);
          }
        }
      });

      // Broadcast presence every 2 seconds
      _broadcastTimer = Timer.periodic(const Duration(seconds: 2), (_) {
        broadcastPresence();
      });

      // Initial broadcast
      broadcastPresence();
    } catch (e) {
      print('DiscoveryService: Error starting advertising: $e');
    }
  }

  /// Broadcast presence beacon to nearby network
  Future<void> broadcastPresence() async {
    _myIp = await NetworkUtils.getLocalIpAddress();
    if (_socket == null || _myIp == null) return;

    final devicePayload = DeviceInfo(
      id: _myDeviceId ?? 'pc_device',
      name: _myDeviceName ?? 'Windows-PC',
      os: NetworkUtils.getDeviceOs(),
      ip: _myIp!,
      port: _receiverPort,
      status: 'Ready to receive',
    );

    final jsonString = jsonEncode({
      'type': 'BEACON',
      'device': devicePayload.toJson(),
    });

    final data = utf8.encode(jsonString);

    try {
      // 1. Send to general broadcast 255.255.255.255
      _socket?.send(data, InternetAddress('255.255.255.255'), udpPort);

      // 2. Also send to local subnet broadcast if available
      final ipParts = _myIp!.split('.');
      if (ipParts.length == 4) {
        final subnetBroadcast = '${ipParts[0]}.${ipParts[1]}.${ipParts[2]}.255';
        _socket?.send(data, InternetAddress(subnetBroadcast), udpPort);
      }
    } catch (e) {
      print('DiscoveryService: Broadcast send error: $e');
    }
  }

  /// Start scanning for nearby devices (used by Android Sender)
  Future<void> startScanning() async {
    if (_isScanning) return;
    _myDeviceName = await NetworkUtils.getDeviceName();
    _myIp = await NetworkUtils.getLocalIpAddress();
    _myDeviceId = '${_myDeviceName}_${_myIp ?? "phone"}';

    try {
      if (_socket == null) {
        _socket = await RawDatagramSocket.bind(
          InternetAddress.anyIPv4,
          udpPort,
          reuseAddress: true,
          reusePort: false,
        );
        _socket?.broadcastEnabled = true;

        _socket?.listen((RawSocketEvent event) {
          if (event == RawSocketEvent.read) {
            final datagram = _socket?.receive();
            if (datagram != null) {
              _handleIncomingDatagram(datagram);
            }
          }
        });
      }

      _isScanning = true;
      notifyListeners();

      // Send immediate PING broadcast to trigger fast responses from nearby PCs
      sendPingBroadcast();

      // Timer to prune devices not seen for > 6 seconds
      _cleanupTimer?.cancel();
      _cleanupTimer = Timer.periodic(const Duration(seconds: 3), (_) {
        final now = DateTime.now();
        bool changed = false;
        _discoveredDevices.removeWhere((id, device) {
          final isStale = now.difference(device.lastSeen).inSeconds > 6;
          if (isStale) changed = true;
          return isStale;
        });
        if (changed) {
          notifyListeners();
        }
      });
    } catch (e) {
      print('DiscoveryService: Error starting scanning: $e');
    }
  }

  /// Send PING message to force active receivers to reply immediately
  void sendPingBroadcast() async {
    if (_socket == null) return;
    _myIp = await NetworkUtils.getLocalIpAddress();

    final pingPayload = jsonEncode({
      'type': 'PING',
      'sender_ip': _myIp,
      'sender_name': _myDeviceName,
    });
    final data = utf8.encode(pingPayload);

    try {
      _socket?.send(data, InternetAddress('255.255.255.255'), udpPort);
      if (_myIp != null) {
        final ipParts = _myIp!.split('.');
        if (ipParts.length == 4) {
          final subnetBroadcast = '${ipParts[0]}.${ipParts[1]}.${ipParts[2]}.255';
          _socket?.send(data, InternetAddress(subnetBroadcast), udpPort);
        }
      }
    } catch (e) {
      print('DiscoveryService: Ping send error: $e');
    }
  }

  void _handleIncomingDatagram(Datagram datagram) {
    try {
      final message = utf8.decode(datagram.data);
      final jsonMap = jsonDecode(message) as Map<String, dynamic>;
      final type = jsonMap['type'];
      final senderIp = datagram.address.address;

      // Ignore our own broadcast messages
      if (senderIp == _myIp) return;

      if (type == 'BEACON') {
        final deviceJson = jsonMap['device'] as Map<String, dynamic>;
        final device = DeviceInfo.fromJson(deviceJson, senderIp);

        // Don't add ourselves if ID matches
        if (device.id == _myDeviceId) return;

        _discoveredDevices[device.id] = device;
        notifyListeners();
      } else if (type == 'PING' && _isAdvertising) {
        // If someone pinged us and we're advertising, respond back immediately
        broadcastPresence();
      }
    } catch (e) {
      // Ignore malformed UDP packets
    }
  }

  void stop() {
    _broadcastTimer?.cancel();
    _cleanupTimer?.cancel();
    _socket?.close();
    _socket = null;
    _isAdvertising = false;
    _isScanning = false;
    _discoveredDevices.clear();
    notifyListeners();
  }

  @override
  void dispose() {
    stop();
    super.dispose();
  }
}
