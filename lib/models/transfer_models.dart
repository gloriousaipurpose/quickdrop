enum TransferStatus {
  idle,
  connecting,
  transferring,
  completed,
  failed,
  cancelled,
}

class FileTransferItem {
  final String id;
  final String fileName;
  final int fileSize;
  final int bytesTransferred;
  final double speedBytesPerSec;
  final String senderName;
  final String targetDeviceName;
  final String? localFilePath;
  final TransferStatus status;
  final String? errorMessage;
  final DateTime timestamp;

  FileTransferItem({
    required this.id,
    required this.fileName,
    required this.fileSize,
    this.bytesTransferred = 0,
    this.speedBytesPerSec = 0.0,
    required this.senderName,
    required this.targetDeviceName,
    this.localFilePath,
    this.status = TransferStatus.idle,
    this.errorMessage,
    DateTime? timestamp,
  }) : timestamp = timestamp ?? DateTime.now();

  double get progressPercentage {
    if (fileSize <= 0) return 0.0;
    final progress = (bytesTransferred / fileSize) * 100.0;
    return progress.clamp(0.0, 100.0);
  }

  String get formattedSpeed {
    if (speedBytesPerSec >= 1024 * 1024) {
      return '${(speedBytesPerSec / (1024 * 1024)).toStringAsFixed(1)} MB/s';
    } else if (speedBytesPerSec >= 1024) {
      return '${(speedBytesPerSec / 1024).toStringAsFixed(1)} KB/s';
    } else {
      return '${speedBytesPerSec.toStringAsFixed(0)} B/s';
    }
  }

  String get formattedSize {
    if (fileSize >= 1024 * 1024 * 1024) {
      return '${(fileSize / (1024 * 1024 * 1024)).toStringAsFixed(2)} GB';
    } else if (fileSize >= 1024 * 1024) {
      return '${(fileSize / (1024 * 1024)).toStringAsFixed(1)} MB';
    } else if (fileSize >= 1024) {
      return '${(fileSize / 1024).toStringAsFixed(1)} KB';
    } else {
      return '$fileSize B';
    }
  }

  FileTransferItem copyWith({
    int? bytesTransferred,
    double? speedBytesPerSec,
    TransferStatus? status,
    String? localFilePath,
    String? errorMessage,
  }) {
    return FileTransferItem(
      id: id,
      fileName: fileName,
      fileSize: fileSize,
      bytesTransferred: bytesTransferred ?? this.bytesTransferred,
      speedBytesPerSec: speedBytesPerSec ?? this.speedBytesPerSec,
      senderName: senderName,
      targetDeviceName: targetDeviceName,
      localFilePath: localFilePath ?? this.localFilePath,
      status: status ?? this.status,
      errorMessage: errorMessage ?? this.errorMessage,
      timestamp: timestamp,
    );
  }
}
