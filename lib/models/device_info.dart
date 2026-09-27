import 'dart:convert';

class DeviceInfo {
  final String id;
  final String name;
  final String os;
  final String ip;
  final int port;
  final String status;
  final DateTime lastSeen;

  DeviceInfo({
    required this.id,
    required this.name,
    required this.os,
    required this.ip,
    required this.port,
    this.status = 'Ready to receive',
    DateTime? lastSeen,
  }) : lastSeen = lastSeen ?? DateTime.now();

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'os': os,
        'ip': ip,
        'port': port,
        'status': status,
      };

  factory DeviceInfo.fromJson(Map<String, dynamic> json, String senderIp) {
    return DeviceInfo(
      id: json['id'] ?? senderIp,
      name: json['name'] ?? 'Unknown PC',
      os: json['os'] ?? 'Windows',
      ip: json['ip'] != null && (json['ip'] as String).isNotEmpty
          ? json['ip']
          : senderIp,
      port: json['port'] ?? 8080,
      status: json['status'] ?? 'Ready to receive',
      lastSeen: DateTime.now(),
    );
  }

  DeviceInfo copyWith({
    String? status,
    DateTime? lastSeen,
  }) {
    return DeviceInfo(
      id: id,
      name: name,
      os: os,
      ip: ip,
      port: port,
      status: status ?? this.status,
      lastSeen: lastSeen ?? this.lastSeen,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is DeviceInfo && runtimeType == other.runtimeType && id == other.id;

  @override
  int get hashCode => id.hashCode;
}
