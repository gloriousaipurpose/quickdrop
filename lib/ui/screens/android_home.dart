import 'dart:io';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import '../../models/device_info.dart';
import '../../services/discovery_service.dart';
import '../../services/transfer_service.dart';
import '../theme.dart';
import '../widgets/device_card.dart';
import '../widgets/progress_card.dart';
import '../widgets/radar_view.dart';

class AndroidHome extends StatefulWidget {
  final DiscoveryService discoveryService;
  final TransferService transferService;

  const AndroidHome({
    Key? key,
    required this.discoveryService,
    required this.transferService,
  }) : super(key: key);

  @override
  State<AndroidHome> createState() => _AndroidHomeState();
}

class _AndroidHomeState extends State<AndroidHome> {
  final List<File> _selectedFiles = [];
  DeviceInfo? _selectedDevice;

  @override
  void initState() {
    super.initState();
    _initPermissionsAndScanning();
  }

  Future<void> _initPermissionsAndScanning() async {
    if (Platform.isAndroid) {
      await [
        Permission.storage,
        Permission.photos,
        Permission.videos,
        Permission.nearbyWifiDevices,
      ].request();
    }
    widget.discoveryService.startScanning();
  }

  Future<void> _pickFiles() async {
    try {
      final result = await FilePicker.platform.pickFiles(
        allowMultiple: true, // Multi-file selection support
        type: FileType.any,
      );

      if (result != null) {
        final newFiles = result.paths
            .where((path) => path != null)
            .map((path) => File(path!))
            .toList();

        setState(() {
          _selectedFiles.clear();
          _selectedFiles.addAll(newFiles);
        });
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error selecting files: $e')),
      );
    }
  }

  Future<void> _startTransfer() async {
    if (_selectedFiles.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select at least one file first')),
      );
      return;
    }

    if (_selectedDevice == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please tap a nearby PC to send files')),
      );
      return;
    }

    final success = await widget.transferService.sendBatchFiles(
      targetDevice: _selectedDevice!,
      files: _selectedFiles,
    );

    if (success) {
      setState(() {
        _selectedFiles.clear();
      });
    }
  }

  int _getTotalSelectedSize() {
    int total = 0;
    for (var f in _selectedFiles) {
      try {
        total += f.lengthSync();
      } catch (_) {}
    }
    return total;
  }

  String _formatSize(int bytes) {
    if (bytes >= 1024 * 1024 * 1024) {
      return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(2)} GB';
    } else if (bytes >= 1024 * 1024) {
      return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    } else if (bytes >= 1024) {
      return '${(bytes / 1024).toStringAsFixed(1)} KB';
    } else {
      return '$bytes B';
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge([widget.discoveryService, widget.transferService]),
      builder: (context, _) {
        final discovered = widget.discoveryService.discoveredDevices;
        final activeTransfer = widget.transferService.activeTransfer;

        return Scaffold(
          appBar: AppBar(
            title: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: AppTheme.primary.withOpacity(0.2),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.wifi_tethering_rounded, color: AppTheme.primary, size: 22),
                ),
                const SizedBox(width: 12),
                const Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('QuickDrop', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                    Text('Multi-File High-Speed AirDrop', style: TextStyle(color: AppTheme.textSecondary, fontSize: 11)),
                  ],
                ),
              ],
            ),
            actions: [
              IconButton(
                icon: const Icon(Icons.refresh_rounded, color: AppTheme.primary),
                onPressed: () {
                  widget.discoveryService.sendPingBroadcast();
                },
                tooltip: 'Rescan nearby PCs',
              ),
            ],
          ),
          body: SafeArea(
            child: Column(
              children: [
                // Active Transfer Progress Overlay Card
                if (activeTransfer != null)
                  ProgressCard(
                    transferItem: activeTransfer,
                    onDismiss: () {
                      widget.transferService.clearActiveTransfer();
                    },
                  ),

                // Selected Files Summary Card
                Container(
                  margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: AppTheme.surface,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(
                      color: _selectedFiles.isNotEmpty ? AppTheme.primary : const Color(0x1AFFFFFF),
                    ),
                  ),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: _selectedFiles.isNotEmpty
                              ? AppTheme.primary.withOpacity(0.2)
                              : AppTheme.surfaceLight,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Icon(
                          _selectedFiles.isNotEmpty ? Icons.collections_rounded : Icons.add_photo_alternate_rounded,
                          color: _selectedFiles.isNotEmpty ? AppTheme.primary : AppTheme.textSecondary,
                          size: 24,
                        ),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              _selectedFiles.isNotEmpty
                                  ? '${_selectedFiles.length} File${_selectedFiles.length > 1 ? 's' : ''} Selected'
                                  : 'No files selected',
                              style: TextStyle(
                                color: _selectedFiles.isNotEmpty ? AppTheme.textPrimary : AppTheme.textSecondary,
                                fontSize: 15,
                                fontWeight: _selectedFiles.isNotEmpty ? FontWeight.bold : FontWeight.normal,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              _selectedFiles.isNotEmpty
                                  ? 'Total: ${_formatSize(_getTotalSelectedSize())}'
                                  : 'Tap [ Select Files ] to choose multiple files',
                              style: const TextStyle(
                                color: AppTheme.textSecondary,
                                fontSize: 12,
                              ),
                            ),
                          ],
                        ),
                      ),
                      ElevatedButton(
                        onPressed: _pickFiles,
                        style: ElevatedButton.styleFrom(
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                          backgroundColor: _selectedFiles.isNotEmpty ? AppTheme.surfaceLight : AppTheme.primary,
                        ),
                        child: Text(_selectedFiles.isNotEmpty ? 'Change' : 'Select Files'),
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 10),

                // Header for Nearby PCs
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'Nearby Devices',
                        style: TextStyle(
                          color: AppTheme.textPrimary,
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      Row(
                        children: [
                          Container(
                            width: 8,
                            height: 8,
                            decoration: const BoxDecoration(
                              color: AppTheme.accentGreen,
                              shape: BoxShape.circle,
                            ),
                          ),
                          const SizedBox(width: 6),
                          Text(
                            '${discovered.length} found',
                            style: const TextStyle(
                              color: AppTheme.textSecondary,
                              fontSize: 13,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 10),

                // Radar View & Discovered PC List
                Expanded(
                  child: RadarView(
                    isScanning: widget.discoveryService.isScanning,
                    child: discovered.isEmpty
                        ? Center(
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                const Icon(
                                  Icons.radar_rounded,
                                  size: 64,
                                  color: AppTheme.primaryLight,
                                ),
                                const SizedBox(height: 16),
                                const Text(
                                  'Scanning local Wi-Fi for Windows PCs...',
                                  style: TextStyle(
                                    color: AppTheme.textPrimary,
                                    fontSize: 16,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                const SizedBox(height: 8),
                                const Padding(
                                  padding: EdgeInsets.symmetric(horizontal: 32),
                                  child: Text(
                                    'Make sure QuickDrop is running on your PC connected to the same Wi-Fi.',
                                    textAlign: TextAlign.center,
                                    style: TextStyle(
                                      color: AppTheme.textSecondary,
                                      fontSize: 13,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          )
                        : ListView.builder(
                            itemCount: discovered.length,
                            padding: const EdgeInsets.only(bottom: 80),
                            itemBuilder: (context, index) {
                              final device = discovered[index];
                              final isSelected = _selectedDevice?.id == device.id;

                              return DeviceCard(
                                device: device,
                                isSelected: isSelected,
                                onTap: () {
                                  setState(() {
                                    _selectedDevice = device;
                                  });
                                  if (_selectedFiles.isNotEmpty) {
                                    _startTransfer();
                                  } else {
                                    _pickFiles().then((_) {
                                      if (_selectedFiles.isNotEmpty) {
                                        _startTransfer();
                                      }
                                    });
                                  }
                                },
                              );
                            },
                          ),
                  ),
                ),

                // Floating Send Action Bar
                if (_selectedFiles.isNotEmpty && _selectedDevice != null)
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: const BoxDecoration(
                      color: AppTheme.surface,
                      border: Border(top: BorderSide(color: Color(0x1AFFFFFF))),
                    ),
                    child: SizedBox(
                      width: double.infinity,
                      child: ElevatedButton.icon(
                        onPressed: _startTransfer,
                        icon: const Icon(Icons.send_rounded),
                        label: Text('Send ${_selectedFiles.length} File${_selectedFiles.length > 1 ? 's' : ''} to ${_selectedDevice!.name}'),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppTheme.primary,
                          padding: const EdgeInsets.symmetric(vertical: 16),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }
}
