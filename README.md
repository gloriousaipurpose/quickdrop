# 🚀 QuickDrop — Phone-to-Windows File Sharing POC (AirDrop Alternative)

**QuickDrop** is a free, zero-configuration proof-of-concept (POC) application for high-speed file transfer between **Android smartphones** and **Windows PCs** over a shared local Wi-Fi network.

---

## 🎯 Main UX Goal

1. Open QuickDrop on Android phone.
2. Automatically see nearby Windows PCs (e.g. `💻 Shubham-PC` — *Ready to receive*).
3. Select a file.
4. Tap the PC.
5. File streams directly over local Wi-Fi at **high speeds (10–80 MB/s)** with live progress (`████████████░░░ 82%`).
6. Saved directly into the Windows `Downloads/QuickDrop` folder.

---

## 🔒 Principles & Constraints

- **No Cloud / No External Servers**: 100% direct peer-to-peer over local Wi-Fi.
- **No Accounts / No Passwords**: Frictionless AirDrop-style discovery.
- **Zero Cost**: Built 100% using open cross-platform technologies (Flutter & Dart).
- **High Speed**: Uses raw TCP streaming over local network (no slow Bluetooth for payload).

---

## 🏗️ Architecture & How It Works

```
┌─────────────────────────┐                            ┌─────────────────────────┐
│  Android Phone (Sender) │                            │  Windows PC (Receiver)  │
├─────────────────────────┤                            ├─────────────────────────┤
│ 1. UDP Discovery Scan   │ ── UDP Port 41234 Broadcast ─>│ 1. UDP Advertiser       │
│    (Receives PC Beacon) │ <── Device Info JSON ──────│    "Ready to receive"   │
│                         │                            │                         │
│ 2. User Picks File      │                            │                         │
│                         │                            │ 2. HTTP Server Listener │
│ 3. Direct Wi-Fi Stream  │ ── HTTP POST Stream (8080) ─>│    (Port 8080)           │
│    Shows Progress Bar   │ <── 200 OK Response ────────│    Saves to Downloads   │
└─────────────────────────┘                            └─────────────────────────┘
```

1. **Auto Device Discovery**:
   - The Windows application broadcasts a lightweight UDP JSON beacon on port `41234` over the local Wi-Fi subnet.
   - The Android app listens on port `41234` and displays nearby Windows PCs in an animated pulse radar view.

2. **Direct Wi-Fi Transfer**:
   - The Windows PC runs a lightweight HTTP receiver server on port `8080`.
   - The Android app streams the file binary payload in 64KB chunks directly to `http://<PC_IP>:8080/upload`.
   - Real-time byte counters update the UI with percentage (`82%`) and speed (`18.5 MB/s`).

---

## 📁 Repository Directory Structure

```text
c:\Users\Shubham\OneDrive\Desktop\POC\Transfer\
├── pubspec.yaml                 # Flutter configuration & dependencies
├── lib/
│   ├── main.dart                # Application entrypoint & auto-platform layout
│   ├── models/
│   │   ├── device_info.dart     # Discovered PC data structure
│   │   └── transfer_models.dart # Transfer status & progress model
│   ├── services/
│   │   ├── network_utils.dart   # Local IPv4 & device name helper
│   │   ├── discovery_service.dart # UDP broadcast advertiser & scanner
│   │   └── transfer_service.dart  # HTTP receiver server & file uploader
│   └── ui/
│       ├── theme.dart           # Dark mode styling & color palette
│       ├── screens/
│       │   ├── android_home.dart # Mobile UI (Radar, file picker, send flow)
│       │   └── windows_home.dart # Desktop UI (Dashboard, status, history, save folder picker)
│       └── widgets/
│           ├── radar_view.dart   # Animated pulsating AirDrop radar rings
│           ├── device_card.dart  # Interactive PC card
│           └── progress_card.dart# Real-time progress bar widget
├── android/                     # Android Gradle configuration & permissions
├── windows/                     # Windows C++ Desktop runner configuration
├── web_fallback/
│   └── server.js                # Instant zero-install Node.js script for immediate testing
└── README.md                    # Project documentation & setup guide
```

---

## 🚀 How to Run & Build

### Option A: Flutter Build (Recommended)

#### 1. Running on Windows Desktop

Open terminal in this directory:
```bash
flutter run -d windows
```
*The Windows app will launch, show **🟢 Ready to Receive**, advertise itself on UDP port 41234, and listen on HTTP port 8080.*

#### 2. Building Android APK

Build release APK:
```bash
flutter build apk --release
```
The compiled APK will be output to:
`build/app/outputs/flutter-apk/app-release.apk`

#### 3. Installing APK on Android Phone

- **Method 1 (ADB / USB)**:
  Connect Android phone with USB Debugging enabled:
  ```bash
  flutter install
  ```
- **Method 2 (Direct File Share / WhatsApp / Google Drive)**:
  Copy `app-release.apk` to your phone and tap to install directly.

---

### Option B: Instant Zero-Install Testing (Node.js Fallback)

If Flutter SDK is not set up on your PATH yet, you can test the exact local Wi-Fi file transfer using Node.js:

1. Open terminal and run:
   ```bash
   node web_fallback/server.js
   ```
2. The server will output your local IP (e.g. `http://192.168.1.15:8080`).
3. Open your Android phone's web browser, navigate to `http://192.168.1.15:8080`, pick a file, and tap **Transfer Now**.
4. The file will transfer over local Wi-Fi and save directly into `C:\Users\Shubham\Downloads\QuickDrop`.

---

## ✅ Verification Checklist

- [x] **Local Wi-Fi Auto Discovery**: UDP broadcast discovers nearby PCs automatically without typing IP addresses.
- [x] **Direct High-Speed Transfer**: Files stream directly PC-to-Phone over local Wi-Fi.
- [x] **Live Progress Bar**: Shows percentage, transfer speed (MB/s), and completed state.
- [x] **Auto Save Destination**: Saved to Windows Downloads directory with 1-click "Open in Explorer".
- [x] **Zero Cloud / Zero Cost**: 100% free and offline.
