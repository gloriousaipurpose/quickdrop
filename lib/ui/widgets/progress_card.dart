import 'package:flutter/material.dart';
import '../../models/transfer_models.dart';
import '../theme.dart';

class ProgressCard extends StatelessWidget {
  final FileTransferItem transferItem;
  final VoidCallback? onDismiss;
  final VoidCallback? onOpenFile;

  const ProgressCard({
    Key? key,
    required this.transferItem,
    this.onDismiss,
    this.onOpenFile,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final isCompleted = transferItem.status == TransferStatus.completed;
    final isFailed = transferItem.status == TransferStatus.failed;
    final isTransferring = transferItem.status == TransferStatus.transferring ||
        transferItem.status == TransferStatus.connecting;

    final progress = transferItem.progressPercentage;

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: isCompleted
              ? AppTheme.accentGreen.withOpacity(0.5)
              : isFailed
                  ? Colors.redAccent.withOpacity(0.5)
                  : AppTheme.primary.withOpacity(0.5),
          width: 1.5,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.2),
            blurRadius: 10,
            offset: const Offset(0, 4),
          )
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: isCompleted
                      ? AppTheme.accentGreen.withOpacity(0.15)
                      : isFailed
                          ? Colors.redAccent.withOpacity(0.15)
                          : AppTheme.primary.withOpacity(0.15),
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  isCompleted
                      ? Icons.check_circle_rounded
                      : isFailed
                          ? Icons.error_rounded
                          : Icons.swap_vert_rounded,
                  color: isCompleted
                      ? AppTheme.accentGreen
                      : isFailed
                          ? Colors.redAccent
                          : AppTheme.primary,
                  size: 24,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      transferItem.fileName,
                      style: const TextStyle(
                        color: AppTheme.textPrimary,
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${transferItem.senderName} → ${transferItem.targetDeviceName} • ${transferItem.formattedSize}',
                      style: const TextStyle(
                        color: AppTheme.textSecondary,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
              if (onDismiss != null && !isTransferring)
                IconButton(
                  icon: const Icon(Icons.close_rounded, color: AppTheme.textSecondary, size: 20),
                  onPressed: onDismiss,
                ),
            ],
          ),
          const SizedBox(height: 14),

          // Progress Bar
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: LinearProgressIndicator(
              value: isCompleted ? 1.0 : (progress / 100.0),
              minHeight: 10,
              backgroundColor: AppTheme.surfaceLight,
              valueColor: AlwaysStoppedAnimation<Color>(
                isCompleted
                    ? AppTheme.accentGreen
                    : isFailed
                        ? Colors.redAccent
                        : AppTheme.primary,
              ),
            ),
          ),
          const SizedBox(height: 10),

          // Status & Percentage Footer
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                isCompleted
                    ? '✓ Transfer Complete'
                    : isFailed
                        ? '✗ Failed: ${transferItem.errorMessage ?? "Network error"}'
                        : 'Transferring file... (${transferItem.formattedSpeed})',
                style: TextStyle(
                  color: isCompleted
                      ? AppTheme.accentGreen
                      : isFailed
                          ? Colors.redAccent
                          : AppTheme.textSecondary,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
              Text(
                isCompleted ? '100%' : '${progress.toStringAsFixed(0)}%',
                style: const TextStyle(
                  color: AppTheme.textPrimary,
                  fontSize: 14,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),

          if (isCompleted && onOpenFile != null) ...[
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: onOpenFile,
                icon: const Icon(Icons.folder_open_rounded, size: 18),
                label: const Text('Open File / Folder'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppTheme.accentGreen,
                  padding: const EdgeInsets.symmetric(vertical: 10),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
