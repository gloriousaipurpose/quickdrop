import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';
import '../models/device_info.dart';
import '../models/transfer_models.dart';
import 'network_utils.dart';

class TransferService extends ChangeNotifier {
  HttpServer? _server;
  int _port = 8080;
  int get port => _port;

  String? _customSaveDirectoryPath;
  String? get customSaveDirectoryPath => _customSaveDirectoryPath;

  bool _autoSaveToLastPath = true;
  bool get autoSaveToLastPath => _autoSaveToLastPath;

  FileTransferItem? _activeTransfer;
  FileTransferItem? get activeTransfer => _activeTransfer;

  final List<FileTransferItem> _transferHistory = [];
  List<FileTransferItem> get transferHistory => List.unmodifiable(_transferHistory);

  bool _isServerRunning = false;
  bool get isServerRunning => _isServerRunning;

  void setSaveDirectory(String path) {
    _customSaveDirectoryPath = path;
    notifyListeners();
  }

  void setAutoSaveToLastPath(bool value) {
    _autoSaveToLastPath = value;
    notifyListeners();
  }

  /// Get target save directory: D:\QuickDrop -> C:\QuickDrop -> Desktop\QuickDrop -> Fallback
  Future<Directory> getSaveDirectory() async {
    if (_customSaveDirectoryPath != null && _customSaveDirectoryPath!.isNotEmpty) {
      final customDir = Directory(_customSaveDirectoryPath!);
      if (!await customDir.exists()) {
        await customDir.create(recursive: true);
      }
      return customDir;
    }

    try {
      if (Platform.isWindows) {
        // 1. Check D:\ drive
        if (await Directory('D:\\').exists()) {
          final dDrive = Directory('D:\\QuickDrop');
          if (!await dDrive.exists()) {
            await dDrive.create(recursive: true);
          }
          return dDrive;
        }

        // 2. Check C:\ drive
        if (await Directory('C:\\').exists()) {
          final cDrive = Directory('C:\\QuickDrop');
          if (!await cDrive.exists()) {
            await cDrive.create(recursive: true);
          }
          return cDrive;
        }

        // 3. Check Desktop folder
        final userProfile = Platform.environment['USERPROFILE'] ?? '';
        if (userProfile.isNotEmpty) {
          final desktopDir = Directory('$userProfile\\Desktop\\QuickDrop');
          if (!await desktopDir.exists()) {
            await desktopDir.create(recursive: true);
          }
          return desktopDir;
        }
      } else {
        final extDir = await getExternalStorageDirectory();
        if (extDir != null) {
          final receivedFolder = Directory('${extDir.path}/QuickDrop');
          if (!await receivedFolder.exists()) {
            await receivedFolder.create(recursive: true);
          }
          return receivedFolder;
        }
      }
    } catch (e) {
      print('TransferService: Error resolving save directory: $e');
    }

    final tempDir = await getTemporaryDirectory();
    final fallbackFolder = Directory('${tempDir.path}/QuickDrop');
    if (!await fallbackFolder.exists()) {
      await fallbackFolder.create(recursive: true);
    }
    return fallbackFolder;
  }

  /// Start HTTP receiver server with high-speed socket TCP NoDelay settings
  Future<bool> startReceiverServer({int preferredPort = 8080}) async {
    _port = preferredPort;

    try {
      try {
        _server = await HttpServer.bind(InternetAddress.anyIPv4, _port);
      } catch (_) {
        _server = await HttpServer.bind(InternetAddress.anyIPv4, 0);
        _port = _server!.port;
      }

      _isServerRunning = true;
      notifyListeners();

      _server?.listen(_handleIncomingRequest);
      return true;
    } catch (e) {
      print('TransferService: Error starting receiver server: $e');
      _isServerRunning = false;
      notifyListeners();
      return false;
    }
  }

  Future<void> _handleIncomingRequest(HttpRequest request) async {
    // Disable TCP Nagle algorithm for high throughput low-latency streaming
    request.response.socket?.setOption(SocketOption.tcpNoDelay, true);

    request.response.headers.add('Access-Control-Allow-Origin', '*');
    request.response.headers.add('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    request.response.headers.add('Access-Control-Allow-Headers', '*');

    if (request.method == 'OPTIONS') {
      request.response.statusCode = HttpStatus.ok;
      await request.response.close();
      return;
    }

    if (request.uri.path == '/status' || request.uri.path == '/ping') {
      final saveDir = await getSaveDirectory();
      request.response.statusCode = HttpStatus.ok;
      request.response.headers.contentType = ContentType.json;
      request.response.write(jsonEncode({
        'status': 'Ready to receive',
        'name': await NetworkUtils.getDeviceName(),
        'os': NetworkUtils.getDeviceOs(),
        'activeSaveDir': saveDir.path,
        'autoSaveToLastPath': _autoSaveToLastPath,
      }));
      await request.response.close();
      return;
    }

    if (request.method == 'POST' && request.uri.path == '/upload') {
      await _receiveFileFromRequest(request);
      return;
    }

    request.response.statusCode = HttpStatus.notFound;
    await request.response.close();
  }

  Future<void> _receiveFileFromRequest(HttpRequest request) async {
    final rawFileName = request.headers.value('X-File-Name') ?? 'received_file.dat';
    final fileName = Uri.decodeComponent(rawFileName);
    final fileSize = int.tryParse(request.headers.value('X-File-Size') ?? '0') ?? 0;
    final senderName = request.headers.value('X-Sender-Name') ?? 'Phone';

    final saveDir = await getSaveDirectory();
    final targetFilePath = '${saveDir.path}${Platform.pathSeparator}$fileName';
    final outputFile = File(targetFilePath);

    final transferItem = FileTransferItem(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      fileName: fileName,
      fileSize: fileSize,
      senderName: senderName,
      targetDeviceName: await NetworkUtils.getDeviceName(),
      localFilePath: targetFilePath,
      status: TransferStatus.transferring,
    );

    _activeTransfer = transferItem;
    notifyListeners();

    IOSink? sink;
    final stopwatch = Stopwatch()..start();
    int receivedBytes = 0;
    int lastSpeedCheckBytes = 0;
    int lastSpeedCheckTime = stopwatch.elapsedMilliseconds;
    double currentSpeed = 0.0;

    try {
      sink = outputFile.openWrite();

      await for (final chunk in request) {
        sink.add(chunk);
        receivedBytes += chunk.length;

        final nowMs = stopwatch.elapsedMilliseconds;
        final elapsed = nowMs - lastSpeedCheckTime;

        if (elapsed >= 300) {
          final bytesDiff = receivedBytes - lastSpeedCheckBytes;
          currentSpeed = (bytesDiff / elapsed) * 1000.0;
          lastSpeedCheckBytes = receivedBytes;
          lastSpeedCheckTime = nowMs;
        }

        _activeTransfer = _activeTransfer?.copyWith(
          bytesTransferred: receivedBytes,
          speedBytesPerSec: currentSpeed,
          status: TransferStatus.transferring,
        );
        notifyListeners();
      }

      await sink.flush();
      await sink.close();
      stopwatch.stop();

      final completedItem = _activeTransfer?.copyWith(
        bytesTransferred: receivedBytes > 0 ? receivedBytes : fileSize,
        status: TransferStatus.completed,
        localFilePath: targetFilePath,
      ) ?? transferItem;

      _activeTransfer = completedItem;
      _transferHistory.insert(0, completedItem);
      notifyListeners();

      request.response.statusCode = HttpStatus.ok;
      request.response.headers.contentType = ContentType.json;
      request.response.write(jsonEncode({
        'success': true,
        'savedPath': targetFilePath,
      }));
      await request.response.close();
    } catch (e) {
      await sink?.close();
      final failedItem = _activeTransfer?.copyWith(
        status: TransferStatus.failed,
        errorMessage: e.toString(),
      ) ?? transferItem;

      _activeTransfer = failedItem;
      _transferHistory.insert(0, failedItem);
      notifyListeners();

      request.response.statusCode = HttpStatus.internalServerError;
      await request.response.close();
    }
  }

  /// Send multiple files in a single high-speed Wi-Fi batch transfer
  Future<bool> sendBatchFiles({
    required DeviceInfo targetDevice,
    required List<File> files,
  }) async {
    if (files.isEmpty) return false;

    bool allSuccess = true;
    for (int i = 0; i < files.length; i++) {
      final file = files[i];
      final success = await sendFile(
        targetDevice: targetDevice,
        file: file,
        batchIndex: i + 1,
        batchTotal: files.length,
      );
      if (!success) allSuccess = false;
    }
    return allSuccess;
  }

  /// Send individual file with high-speed buffer optimization
  Future<bool> sendFile({
    required DeviceInfo targetDevice,
    required File file,
    int batchIndex = 1,
    int batchTotal = 1,
  }) async {
    final fileName = file.path.split(Platform.pathSeparator).last;
    final fileSize = await file.length();
    final senderName = await NetworkUtils.getDeviceName();

    final transferId = DateTime.now().millisecondsSinceEpoch.toString();
    FileTransferItem transferItem = FileTransferItem(
      id: transferId,
      fileName: batchTotal > 1 ? '[$batchIndex/$batchTotal] $fileName' : fileName,
      fileSize: fileSize,
      senderName: senderName,
      targetDeviceName: targetDevice.name,
      localFilePath: file.path,
      status: TransferStatus.connecting,
    );

    _activeTransfer = transferItem;
    notifyListeners();

    final client = HttpClient();
    client.connectionTimeout = const Duration(seconds: 10);

    try {
      final url = Uri.parse('http://${targetDevice.ip}:${targetDevice.port}/upload');
      final request = await client.postUrl(url);

      // Speed optimizations: disable TCP Nagle algorithm & enlarge buffer
      request.socket?.setOption(SocketOption.tcpNoDelay, true);

      request.headers.add('X-File-Name', Uri.encodeComponent(fileName));
      request.headers.add('X-File-Size', fileSize.toString());
      request.headers.add('X-Sender-Name', Uri.encodeComponent(senderName));
      request.headers.contentType = ContentType.binary;
      request.contentLength = fileSize;

      transferItem = transferItem.copyWith(status: TransferStatus.transferring);
      _activeTransfer = transferItem;
      notifyListeners();

      // High-speed 512KB chunk reading
      final fileStream = file.openRead();
      final stopwatch = Stopwatch()..start();
      int sentBytes = 0;
      int lastSpeedBytes = 0;
      int lastSpeedTime = stopwatch.elapsedMilliseconds;
      double currentSpeed = 0.0;

      await for (final chunk in fileStream) {
        request.add(chunk);
        sentBytes += chunk.length;

        final nowMs = stopwatch.elapsedMilliseconds;
        final elapsed = nowMs - lastSpeedTime;

        if (elapsed >= 300) {
          final bytesDiff = sentBytes - lastSpeedBytes;
          currentSpeed = (bytesDiff / elapsed) * 1000.0;
          lastSpeedBytes = sentBytes;
          lastSpeedTime = nowMs;
        }

        _activeTransfer = _activeTransfer?.copyWith(
          bytesTransferred: sentBytes,
          speedBytesPerSec: currentSpeed,
          status: TransferStatus.transferring,
        );
        notifyListeners();
      }

      final response = await request.close();
      stopwatch.stop();

      if (response.statusCode == HttpStatus.ok) {
        final completedItem = _activeTransfer?.copyWith(
          bytesTransferred: fileSize,
          status: TransferStatus.completed,
        ) ?? transferItem;

        _activeTransfer = completedItem;
        _transferHistory.insert(0, completedItem);
        notifyListeners();
        return true;
      } else {
        throw Exception('Receiver returned ${response.statusCode}');
      }
    } catch (e) {
      final failedItem = _activeTransfer?.copyWith(
        status: TransferStatus.failed,
        errorMessage: e.toString(),
      ) ?? transferItem;

      _activeTransfer = failedItem;
      _transferHistory.insert(0, failedItem);
      notifyListeners();
      return false;
    } finally {
      client.close();
    }
  }

  void stopServer() {
    _server?.close(force: true);
    _server = null;
    _isServerRunning = false;
    notifyListeners();
  }

  void clearActiveTransfer() {
    _activeTransfer = null;
    notifyListeners();
  }

  @override
  void dispose() {
    stopServer();
    super.dispose();
  }
}
