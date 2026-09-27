import 'package:flutter/material.dart';
import '../theme.dart';

class RadarView extends StatefulWidget {
  final bool isScanning;
  final Widget child;

  const RadarView({
    Key? key,
    required this.isScanning,
    required this.child,
  }) : super(key: key);

  @override
  State<RadarView> createState() => _RadarViewState();
}

class _RadarViewState extends State<RadarView> with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 3),
    );
    if (widget.isScanning) {
      _controller.repeat();
    }
  }

  @override
  void didUpdateWidget(covariant RadarView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.isScanning && !_controller.isAnimating) {
      _controller.repeat();
    } else if (!widget.isScanning && _controller.isAnimating) {
      _controller.stop();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        return CustomPaint(
          painter: _RadarPainter(
            progress: _controller.value,
            isScanning: widget.isScanning,
          ),
          child: widget.child,
        );
      },
    );
  }
}

class _RadarPainter extends CustomPainter {
  final double progress;
  final bool isScanning;

  _RadarPainter({required this.progress, required this.isScanning});

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final maxRadius = size.width / 2;

    final paintBg = Paint()
      ..color = AppTheme.surfaceLight.withOpacity(0.15)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.0;

    // Draw static concentric circles
    canvas.drawCircle(center, maxRadius * 0.35, paintBg);
    canvas.drawCircle(center, maxRadius * 0.65, paintBg);
    canvas.drawCircle(center, maxRadius * 0.95, paintBg);

    if (!isScanning) return;

    // Draw expanding animated wave pulses
    for (int i = 0; i < 3; i++) {
      final pulseProgress = (progress + (i * 0.33)) % 1.0;
      final radius = maxRadius * pulseProgress;
      final opacity = (1.0 - pulseProgress).clamp(0.0, 1.0) * 0.4;

      final wavePaint = Paint()
        ..color = AppTheme.primary.withOpacity(opacity)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.0;

      canvas.drawCircle(center, radius, wavePaint);
    }
  }

  @override
  bool shouldRepaint(covariant _RadarPainter oldDelegate) {
    return oldDelegate.progress != progress || oldDelegate.isScanning != isScanning;
  }
}
