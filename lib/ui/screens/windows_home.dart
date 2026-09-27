import 'dart:io';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import '../../services/discovery_service.dart';
import '../../services/network_utils.dart';
import '../../services/transfer_service.dart';
import '../theme.dart';
import '../widgets/progress_card.dart';

class WindowsHome extends StatefulWidget {
  final DiscoveryService discoveryService;
  final TransferService transferService;

  const WindowsHome({
    Key? key,
    required this.discoveryService,
    required this.transferService,
  }) : super(key: key);

  @override
  State<WindowsHome> createState() => _WindowsHomeState();
}

class _WindowsHomeState extends State<WindowsHome> {
  String _pcName = 'Shubham-PC';
  String? _pcIp = '192.168.1.15';
  String _saveFolderPath = '';

  @override
  void initState() {
    super.initState();
    _initWindowsServer();
  }

  Future<void> _initWindowsServer() async {
    _pcName = await NetworkUtils.getDeviceName();
    _pcIp = await NetworkUtils.getLocalIpAddress();

    // Start HTTP receiver server on port 8080
    await widget.transferService.startReceiverServer(preferredPort: 8080);

    // Start advertising this PC on local Wi-Fi via UDP broadcast
    widget.discoveryService.startAdvertising(receiverPort: widget.transferService.port);

    final saveDir = await widget.transferService.getSaveDirectory();
    setState(() {
      _saveFolderPath = saveDir.path;
    });
  }

  Future<void> _selectSaveDirectory() async {
    final selectedDirectory = await FilePicker.platform.getDirectoryPath(
      dialogTitle: 'Select Where Received Files Are Saved',
      initialDirectory: _saveFolderPath,
    );

    if (selectedDirectory != null) {
      widget.transferService.setSaveDirectory(selectedDirectory);
      setState(() {
        _saveFolderPath = selectedDirectory;
      });
    }
  }

  Future<void> _openSaveDirectory() async {
    if (_saveFolderPath.isNotEmpty) {
      try {
        if (Platform.isWindows) {
          await Process.run('explorer.exe', [_saveFolderPath]);
        }
      } catch (e) {
        print('Error opening Explorer: $e');
      }
    }
  }

  Future<void> _openFile(String? filePath) async {
    if (filePath != null && await File(filePath).exists()) {
      try {
        if (Platform.isWindows) {
          await Process.run('cmd', ['/c', 'start', '""', filePath]);
        }
      } catch (e) {
        print('Error opening file: $e');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge([widget.discoveryService, widget.transferService]),
      builder: (context, _) {
        final activeTransfer = widget.transferService.activeTransfer;
        final history = widget.transferService.transferHistory;
        final isRunning = widget.transferService.isServerRunning;

        return Scaffold(
          body: Row(
            children: [
              // Sidebar Navigation / Status Panel
              Container(
                width: 320,
                color: AppTheme.surface,
                padding: const EdgeInsets.all(24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            gradient: AppTheme.primaryGradient,
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: const Icon(Icons.desktop_windows_rounded, color: Colors.white, size: 28),
                        ),
                        const SizedBox(width: 14),
                        const Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'QuickDrop',
                              style: TextStyle(
                                color: AppTheme.textPrimary,
                                fontSize: 20,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            Text(
                              'Windows Receiver',
                              style: TextStyle(
                                color: AppTheme.textSecondary,
                                fontSize: 12,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                    const SizedBox(height: 32),

                    // Status Badge Card
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: AppTheme.surfaceLight.withOpacity(0.3),
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(
                          color: isRunning ? AppTheme.accentGreen.withOpacity(0.5) : Colors.amber.withOpacity(0.5),
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Container(
                                width: 10,
                                height: 10,
                                decoration: BoxDecoration(
                                  color: isRunning ? AppTheme.accentGreen : Colors.amber,
                                  shape: BoxShape.circle,
                                  boxShadow: [
                                    BoxShadow(
                                      color: isRunning ? AppTheme.accentGreen : Colors.amber,
                                      blurRadius: 8,
                                    )
                                  ],
                                ),
                              ),
                              const SizedBox(width: 10),
                              Text(
                                isRunning ? 'Ready to receive' : 'Initializing...',
                                style: TextStyle(
                                  color: isRunning ? AppTheme.accentGreen : Colors.amber,
                                  fontSize: 16,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          Text('PC Name: $_pcName', style: const TextStyle(color: AppTheme.textPrimary, fontSize: 13, fontWeight: FontWeight.w600)),
                          const SizedBox(height: 4),
                          Text('IP Address: ${_pcIp ?? "Searching..."}', style: const TextStyle(color: AppTheme.textSecondary, fontSize: 13)),
                          const SizedBox(height: 4),
                          Text('Port: ${widget.transferService.port}', style: const TextStyle(color: AppTheme.textSecondary, fontSize: 13)),
                        ],
                      ),
                    ),

                    const SizedBox(height: 24),

                    // Save Folder Info
                    const Text(
                      'Save Destination',
                      style: TextStyle(
                        color: AppTheme.textPrimary,
                        fontSize: 14,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppTheme.background,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: const Color(0x1AFFFFFF)),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.folder_rounded, color: AppTheme.primaryLight, size: 20),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              _saveFolderPath.isNotEmpty ? _saveFolderPath : 'Loading folder...',
                              style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12),
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: _selectSaveDirectory,
                            icon: const Icon(Icons.edit_folder_rounded, size: 16),
                            label: const Text('Change'),
                            style: OutlinedButton.styleFrom(
                              foregroundColor: AppTheme.textPrimary,
                              side: const BorderSide(color: Color(0x33FFFFFF)),
                              padding: const EdgeInsets.symmetric(vertical: 10),
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: ElevatedButton.icon(
                            onPressed: _openSaveDirectory,
                            icon: const Icon(Icons.open_in_new_rounded, size: 16),
                            label: const Text('Open'),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: AppTheme.primary,
                              padding: const EdgeInsets.symmetric(vertical: 10),
                            ),
                          ),
                        ),
                      ],
                    ),

                    const Spacer(),
                    const Text(
                      'Direct Local Wi-Fi Transfer\nNo Cloud • No Setup',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: AppTheme.textSecondary, fontSize: 11),
                    ),
                  ],
                ),
              ),

              // Main Content Area
              Expanded(
                child: Container(
                  color: AppTheme.background,
                  padding: const EdgeInsets.all(32),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Live Receiving Dashboard',
                        style: TextStyle(
                          color: AppTheme.textPrimary,
                          fontSize: 24,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 4),
                      const Text(
                        'Open QuickDrop on your Android phone to discover this PC and send files directly.',
                        style: TextStyle(color: AppTheme.textSecondary, fontSize: 14),
                      ),

                      const SizedBox(height: 24),

                      // Active Incoming Transfer Card
                      if (activeTransfer != null) ...[
                        const Text(
                          'Active Transfer',
                          style: TextStyle(color: AppTheme.textPrimary, fontSize: 16, fontWeight: FontWeight.bold),
                        ),
                        const SizedBox(height: 8),
                        ProgressCard(
                          transferItem: activeTransfer,
                          onOpenFile: () => _openFile(activeTransfer.localFilePath),
                          onDismiss: () => widget.transferService.clearActiveTransfer(),
                        ),
                        const SizedBox(height: 24),
                      ],

                      // History Header
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Text(
                            'Received Files History',
                            style: TextStyle(
                              color: AppTheme.textPrimary,
                              fontSize: 18,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          Text(
                            '${history.length} items',
                            style: const TextStyle(color: AppTheme.textSecondary, fontSize: 13),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),

                      // Transfer History List
                      Expanded(
                        child: history.isEmpty
                            ? Center(
                                child: Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Icon(Icons.cloud_download_rounded, size: 64, color: AppTheme.surfaceLight.withOpacity(0.5)),
                                    const SizedBox(height: 16),
                                    const Text(
                                      'No files received yet',
                                      style: TextStyle(color: AppTheme.textPrimary, fontSize: 16, fontWeight: FontWeight.w600),
                                    ),
                                    const SizedBox(height: 6),
                                    const Text(
                                      'Files sent from phone will appear here automatically',
                                      style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
                                    ),
                                  ],
                                ),
                              )
                            : ListView.builder(
                                itemCount: history.length,
                                itemBuilder: (context, index) {
                                  return Card(
                                    margin: const EdgeInsets.symmetric(vertical: 6),
                                    color: AppTheme.surface,
                                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                                    child: ListTile(
                                      leading: const Icon(Icons.insert_drive_file_rounded, color: AppTheme.accentGreen),
                                      title: Text(item.fileName, style: const TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
                                      subtitle: Text('${item.senderName} • ${item.formattedSize}', style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
                                      trailing: IconButton(
                                        icon: const Icon(Icons.open_in_new_rounded, color: AppTheme.primaryLight),
                                        onPressed: () => _openFile(item.localFilePath),
                                      ),
                                    ),
                                  );
                                },
                              ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
