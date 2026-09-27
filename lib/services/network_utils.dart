import 'dart:io';

class NetworkUtils {
  static Future<String?> getLocalIpAddress() async {
    try {
      final interfaces = await NetworkInterface.list(
        type: InternetAddressType.IPv4,
        includeLinkLocal: false,
      );

      for (var interface in interfaces) {
        // Skip loopback, virtual interfaces, vEthernet, docker, etc.
        final lowerName = interface.name.toLowerCase();
        if (lowerName.contains('loopback') ||
            lowerName.contains('vethernet') ||
            lowerName.contains('wsl') ||
            lowerName.contains('docker') ||
            lowerName.contains('virtual')) {
          continue;
        }

        for (var addr in interface.addresses) {
          if (!addr.isLoopback && !addr.isLinkLocal) {
            final ip = addr.address;
            // Prefer private Wi-Fi / LAN IP ranges
            if (ip.startsWith('192.168.') ||
                ip.startsWith('10.') ||
                ip.startsWith('172.16.') ||
                ip.startsWith('172.31.')) {
              return ip;
            }
          }
        }
      }

      // Fallback: Return first non-loopback IP if specific interface filter was missed
      for (var interface in interfaces) {
        for (var addr in interface.addresses) {
          if (!addr.isLoopback) {
            return addr.address;
          }
        }
      }
    } catch (e) {
      print('Error getting local IP address: $e');
    }
    return null;
  }

  static Future<String> getDeviceName() async {
    try {
      final hostName = Platform.localHostname;
      if (hostName.isNotEmpty && hostName != 'localhost') {
        return hostName;
      }
    } catch (_) {}

    if (Platform.isWindows) {
      return 'Windows-PC';
    } else if (Platform.isAndroid) {
      return 'Android-Phone';
    } else if (Platform.isIOS) {
      return 'iPhone';
    } else if (Platform.isMacOS) {
      return 'MacBook';
    } else {
      return 'Nearby-Device';
    }
  }

  static String getDeviceOs() {
    if (Platform.isWindows) return 'Windows';
    if (Platform.isAndroid) return 'Android';
    if (Platform.isIOS) return 'iOS';
    if (Platform.isMacOS) return 'macOS';
    if (Platform.isLinux) return 'Linux';
    return 'Unknown';
  }
}
