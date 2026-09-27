import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'services/discovery_service.dart';
import 'services/transfer_service.dart';
import 'ui/screens/android_home.dart';
import 'ui/screens/windows_home.dart';
import 'ui/theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const QuickDropApp());
}

class QuickDropApp extends StatefulWidget {
  const QuickDropApp({Key? key}) : super(key: key);

  @override
  State<QuickDropApp> createState() => _QuickDropAppState();
}

class _QuickDropAppState extends State<QuickDropApp> {
  final DiscoveryService _discoveryService = DiscoveryService();
  final TransferService _transferService = TransferService();

  // Mode override for easy testing (null = auto-detect by OS)
  bool? _isMobileOverride;

  @override
  void dispose() {
    _discoveryService.dispose();
    _transferService.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Determine platform
    final isDesktopPlatform = kIsWeb ? false : (Platform.isWindows || Platform.isMacOS || Platform.isLinux);
    final isMobileView = _isMobileOverride ?? !isDesktopPlatform;

    return MaterialApp(
      title: 'QuickDrop - Phone to Windows File Share',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.darkTheme,
      home: Stack(
        children: [
          isMobileView
              ? AndroidHome(
                  discoveryService: _discoveryService,
                  transferService: _transferService,
                )
              : WindowsHome(
                  discoveryService: _discoveryService,
                  transferService: _transferService,
                ),

          // Floating mode toggle button for desktop development & testing
          if (isDesktopPlatform)
            Positioned(
              top: 8,
              right: 8,
              child: Material(
                color: Colors.transparent,
                child: Tooltip(
                  message: isMobileView ? 'Switch to Windows Receiver Mode' : 'Switch to Phone Sender Test Mode',
                  child: FloatingActionButton.small(
                    backgroundColor: AppTheme.surfaceLight,
                    child: Icon(
                      isMobileView ? Icons.desktop_windows_rounded : Icons.smartphone_rounded,
                      color: AppTheme.textPrimary,
                      size: 20,
                    ),
                    onPressed: () {
                      setState(() {
                        _isMobileOverride = !isMobileView;
                      });
                    },
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
