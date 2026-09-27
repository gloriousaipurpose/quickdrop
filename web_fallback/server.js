/**
 * QuickDrop Premium Minimalist File Sharing Server
 * Includes Select All & Batch File Downloads, Full Path Displays & 100% Lossless Quality Transfer
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const dgram = require('dgram');
const { exec } = require('child_process');

const PORT = process.env.PORT || 8080;
const UDP_PORT = 41234;

function getDefaultSaveDir() {
  // 1. Check D:\ drive
  try {
    if (fs.existsSync('D:\\')) {
      const dDrivePath = 'D:\\QuickDrop';
      if (!fs.existsSync(dDrivePath)) {
        fs.mkdirSync(dDrivePath, { recursive: true });
      }
      return dDrivePath;
    }
  } catch (e) {}

  // 2. Check C:\ drive
  try {
    if (fs.existsSync('C:\\')) {
      const cDrivePath = 'C:\\QuickDrop';
      if (!fs.existsSync(cDrivePath)) {
        fs.mkdirSync(cDrivePath, { recursive: true });
      }
      return cDrivePath;
    }
  } catch (e) {}

  // 3. Check Desktop folder
  try {
    const desktopPath = path.join(os.homedir(), 'Desktop', 'QuickDrop');
    if (!fs.existsSync(desktopPath)) {
      fs.mkdirSync(desktopPath, { recursive: true });
    }
    return desktopPath;
  } catch (e) {}

  // 4. Fallback for non-Windows (e.g. Linux / Mac / cloud container)
  const fallbackPath = path.join(os.homedir(), 'QuickDrop');
  if (!fs.existsSync(fallbackPath)) {
    fs.mkdirSync(fallbackPath, { recursive: true });
  }
  return fallbackPath;
}

let activeSaveDir = getDefaultSaveDir();
let autoSaveToLastPath = true;
const tempDir = path.join(activeSaveDir, '.temp');

if (!fs.existsSync(tempDir)) {
  try { fs.mkdirSync(tempDir, { recursive: true }); } catch (e) {}
}

let lastConnectedClient = null;
let pendingReceivedFiles = [];
let transferHistory = [];

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        if (net.address.startsWith('192.168.') || net.address.startsWith('10.') || net.address.startsWith('172.')) {
          return net.address;
        }
      }
    }
  }
  return '127.0.0.1';
}

const localIp = getLocalIp();
const pcName = os.hostname();

// Native Windows Folder Browser Dialog Spawner
function openFolderPickerDialog(callback) {
  if (process.platform !== 'win32') {
    return callback(new Error('Native folder picker GUI is supported on Windows PC host.'));
  }
  const psScript = `Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = 'Select QuickDrop Save Directory'; $dialog.ShowNewFolderButton = $true; if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }`;

  exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript}"`, (err, stdout) => {
    if (err) return callback(err);
    const selectedPath = stdout.trim();
    if (selectedPath) {
      callback(null, selectedPath);
    } else {
      callback(new Error('Selection cancelled'));
    }
  });
}

// UDP Advertiser (Local Wi-Fi)
try {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  socket.on('error', (err) => {
    // Ignore UDP socket errors gracefully on cloud environments
  });
  socket.bind(UDP_PORT, () => {
    try {
      socket.setBroadcast(true);
    } catch (e) {}
  });

  function broadcastPresence() {
    const payload = JSON.stringify({
      type: 'BEACON',
      device: {
        id: `${pcName}_${localIp}`,
        name: pcName,
        os: 'Windows',
        ip: localIp,
        port: PORT,
        status: 'Ready to receive',
      },
    });
    socket.send(payload, 0, payload.length, UDP_PORT, '255.255.255.255');
  }

  setInterval(broadcastPresence, 2000);
  broadcastPresence();

  socket.on('message', (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.type === 'PING') broadcastPresence();
    } catch (e) {}
  });
} catch (e) {}

// Robust file moving logic handling cross-device / cross-drive moves (C: vs D:)
function moveTempToFinal(tempFilePath, fileName, targetFolder) {
  if (!fs.existsSync(targetFolder)) {
    fs.mkdirSync(targetFolder, { recursive: true });
  }
  const destPath = path.join(targetFolder, fileName);
  try {
    fs.renameSync(tempFilePath, destPath);
  } catch (err) {
    try {
      fs.copyFileSync(tempFilePath, destPath);
      fs.unlinkSync(tempFilePath);
    } catch (copyErr) {
      console.error('[File Move Error]', copyErr);
    }
  }
  return destPath;
}

const server = http.createServer({ highWaterMark: 1024 * 1024 }, (req, res) => {
  if (req.socket) {
    req.socket.setNoDelay(true);
    req.socket.setKeepAlive(true, 1000);
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const clientIp = req.socket.remoteAddress?.replace(/^.*:/, '') || 'Mobile Device';
  if (clientIp !== '127.0.0.1' && clientIp !== localIp) {
    lastConnectedClient = {
      ip: clientIp,
      name: req.headers['x-sender-name'] ? decodeURIComponent(req.headers['x-sender-name']) : `Device (${clientIp})`,
      time: new Date().toLocaleTimeString(),
    };
  }

  // Direct Lossless File Binary Download Endpoint
  if (req.method === 'GET' && req.url.startsWith('/download')) {
    try {
      const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const fileId = urlObj.searchParams.get('id');
      const item = transferHistory.find(h => h.id === fileId);

      if (!item) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found in transfer history');
        return;
      }

      const filePath = item.finalPath || item.tempPath;
      if (!fs.existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File missing on storage server');
        return;
      }

      const stat = fs.statSync(filePath);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(item.fileName)}"`,
        'Content-Length': stat.size,
        'Cache-Control': 'no-cache',
      });

      fs.createReadStream(filePath).pipe(res);
      return;
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Download error: ' + e.message);
      return;
    }
  }

  if (req.url === '/status' || req.url === '/ping') {
    res.writeHead(200, { 
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.end(JSON.stringify({
      status: 'Ready to receive',
      name: pcName,
      ip: localIp,
      activeSaveDir: activeSaveDir,
      autoSaveToLastPath: autoSaveToLastPath,
      connectedClient: lastConnectedClient,
      history: transferHistory,
      pendingCount: pendingReceivedFiles.length,
      isWindows: process.platform === 'win32',
    }));
    return;
  }

  // Native Folder Browser Dialog Endpoint
  if (req.method === 'POST' && req.url === '/api/select-folder') {
    openFolderPickerDialog((err, newPath) => {
      if (err || !newPath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err ? err.message : 'Cancelled' }));
        return;
      }
      activeSaveDir = newPath;
      if (!fs.existsSync(activeSaveDir)) {
        try { fs.mkdirSync(activeSaveDir, { recursive: true }); } catch (e) {}
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, activeSaveDir }));
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/settings') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const json = JSON.parse(body);
        if (json.activeSaveDir) {
          activeSaveDir = json.activeSaveDir;
          if (!fs.existsSync(activeSaveDir)) fs.mkdirSync(activeSaveDir, { recursive: true });
        }
        if (typeof json.autoSaveToLastPath === 'boolean') {
          autoSaveToLastPath = json.autoSaveToLastPath;
        }
        if (json.processPending && pendingReceivedFiles.length > 0) {
          for (const item of pendingReceivedFiles) {
            const finalPath = moveTempToFinal(item.tempPath, item.fileName, activeSaveDir);
            item.finalPath = finalPath;
            item.saved = true;
            transferHistory.unshift(item);
          }
          pendingReceivedFiles = [];
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, activeSaveDir, autoSaveToLastPath }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Lossless Binary Upload Endpoint (Raw byte-for-byte stream, zero compression)
  if (req.method === 'POST' && req.url === '/upload') {
    const rawFileName = req.headers['x-file-name'] || 'file.dat';
    const fileName = decodeURIComponent(rawFileName);
    const fileSize = parseInt(req.headers['x-file-size'] || '0', 10);
    const senderName = decodeURIComponent(req.headers['x-sender-name'] || 'Client');

    lastConnectedClient = {
      ip: clientIp,
      name: senderName,
      time: new Date().toLocaleTimeString(),
    };

    const tempFilePath = path.join(tempDir, `${Date.now()}_${fileName}`);
    const writeStream = fs.createWriteStream(tempFilePath, { highWaterMark: 1024 * 1024 });

    const startTime = Date.now();
    let received = 0;

    req.on('data', (chunk) => {
      received += chunk.length;
    });

    req.pipe(writeStream);

    writeStream.on('finish', () => {
      const durationSec = Math.max(0.001, (Date.now() - startTime) / 1000);
      const speedMBps = ((received / (1024 * 1024)) / durationSec).toFixed(1);

      console.log(`[Transfer Complete] Received ${fileName} (${(received / 1024 / 1024).toFixed(1)} MB) at ${speedMBps} MB/s from ${senderName}`);

      const fileItem = {
        id: Date.now().toString(),
        fileName: fileName,
        fileSize: received || fileSize,
        senderName: senderName,
        tempPath: tempFilePath,
        time: new Date().toLocaleTimeString(),
        speedMBps: speedMBps,
        saved: false,
      };

      if (autoSaveToLastPath) {
        const finalPath = moveTempToFinal(tempFilePath, fileName, activeSaveDir);
        fileItem.finalPath = finalPath;
        fileItem.saved = true;
        transferHistory.unshift(fileItem);
      } else {
        pendingReceivedFiles.push(fileItem);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        message: 'File received successfully (100% Lossless)',
        saved: fileItem.saved,
        savedPath: fileItem.finalPath || fileItem.tempPath,
        activeSaveDir: activeSaveDir,
        fileId: fileItem.id,
        speed: `${speedMBps} MB/s`,
      }));
    });

    writeStream.on('error', (err) => {
      console.error('[Transfer Error]', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    });
    return;
  }

  // Unified UI
  if (req.url === '/' || req.url === '/index.html') {
    const escapedSaveDir = activeSaveDir.replace(/\\/g, '\\\\');

    res.writeHead(200, { 
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.end(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>QuickDrop — Minimalist File Transfer</title>
  <style>
    :root {
      --bg: #090D16;
      --card: #121A2D;
      --card-border: rgba(255, 255, 255, 0.08);
      --primary: #4F46E5;
      --primary-hover: #4338CA;
      --accent: #10B981;
      --text: #F3F4F6;
      --text-muted: #9CA3AF;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); padding: 24px 16px; min-height: 100vh; display: flex; flex-direction: column; align-items: center; overflow-x: hidden; }
    .container { width: 100%; max-width: 540px; z-index: 2; position: relative; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--card-border); }
    .brand-col { display: flex; flex-direction: column; }
    .brand { font-size: 22px; font-weight: 700; letter-spacing: -0.5px; }
    .greeting { font-size: 13px; color: var(--text-muted); font-weight: 500; margin-top: 2px; }
    .greeting span { color: var(--text); font-weight: 600; }
    .connection-badge { font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 20px; background: rgba(16, 185, 129, 0.1); color: var(--accent); border: 1px solid rgba(16, 185, 129, 0.2); display: flex; align-items: center; gap: 6px; }
    .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
    .tabs { display: flex; background: var(--card); padding: 4px; border-radius: 12px; border: 1px solid var(--card-border); margin-bottom: 20px; }
    .tab { flex: 1; padding: 12px; text-align: center; font-size: 14px; font-weight: 600; color: var(--text-muted); border-radius: 8px; cursor: pointer; transition: all 0.2s; }
    .tab.active { background: var(--primary); color: white; }
    .panel { background: var(--card); border-radius: 16px; border: 1px solid var(--card-border); padding: 24px; margin-bottom: 20px; backdrop-filter: blur(10px); }
    
    /* Save Path Banner Box inside Receiving Panel */
    .save-location-card { background: rgba(255, 255, 255, 0.03); border: 1px solid var(--card-border); border-radius: 12px; padding: 14px; margin-bottom: 20px; }
    .save-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); font-weight: 700; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center; }
    .path-row { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
    .path-input { width: 100%; background: var(--bg); border: 1px solid var(--card-border); color: var(--accent); font-weight: 600; padding: 10px 12px; border-radius: 8px; font-size: 13px; outline: none; }

    .btn { background: var(--primary); color: white; border: none; padding: 14px 20px; border-radius: 10px; font-weight: 600; font-size: 15px; cursor: pointer; width: 100%; transition: background 0.2s; text-decoration: none; display: inline-block; text-align: center; }
    .btn:hover { background: var(--primary-hover); }
    .btn-secondary { background: rgba(255, 255, 255, 0.06); color: var(--text); border: 1px solid var(--card-border); margin-bottom: 0; padding: 10px 14px; font-size: 13px; font-weight: 600; border-radius: 8px; cursor: pointer; transition: all 0.2s; text-decoration: none; display: inline-block; }
    .btn-secondary:hover { background: rgba(255, 255, 255, 0.12); border-color: rgba(255, 255, 255, 0.2); }
    .btn-accent { background: rgba(16, 185, 129, 0.15); color: #10B981; border: 1px solid rgba(16, 185, 129, 0.3); }
    .btn-accent:hover { background: rgba(16, 185, 129, 0.25); }

    .file-box { background: var(--bg); border-radius: 10px; padding: 14px; margin: 14px 0; font-size: 13px; color: var(--text-muted); border: 1px dashed var(--card-border); line-height: 1.5; word-break: break-word; }
    .progress-track { background: rgba(255, 255, 255, 0.05); height: 10px; border-radius: 5px; overflow: hidden; margin: 16px 0; display: none; }
    .progress-fill { background: var(--primary); height: 100%; width: 0%; transition: width 0.1s; }
    .status-text { font-size: 14px; font-weight: 600; text-align: center; margin-top: 8px; }
    .info-row { display: flex; justify-content: space-between; font-size: 13px; padding: 8px 0; border-bottom: 1px solid var(--card-border); }

    /* Success Card */
    .success-card { background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 12px; padding: 14px; margin-top: 14px; display: none; text-align: left; }
    .success-title { font-weight: 700; color: #10B981; font-size: 14px; margin-bottom: 6px; display: flex; align-items: center; gap: 6px; }
    .success-path { font-size: 12px; color: var(--text); word-break: break-all; margin-bottom: 10px; }

    /* Name Onboarding Modal */
    .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(9, 13, 22, 0.9); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; z-index: 999; }
    .modal-card { background: var(--card); border: 1px solid var(--card-border); border-radius: 20px; padding: 32px 24px; width: 90%; max-width: 400px; text-align: center; }

    /* Prominent "HAVE PATIENCE" Watermark Banner */
    .patience-banner {
      text-align: center;
      font-size: 15px;
      font-weight: 800;
      letter-spacing: 5px;
      text-transform: uppercase;
      color: rgba(255, 255, 255, 0.45);
      background: rgba(255, 255, 255, 0.04);
      border: 1px dashed rgba(255, 255, 255, 0.15);
      border-radius: 12px;
      padding: 10px 16px;
      margin-bottom: 20px;
      user-select: none;
    }

    /* Background Watermark */
    .watermark-bg {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-12deg);
      font-size: clamp(52px, 12vw, 110px);
      font-weight: 900;
      letter-spacing: 12px;
      text-transform: uppercase;
      color: rgba(255, 255, 255, 0.07);
      pointer-events: none;
      user-select: none;
      z-index: 1;
      white-space: nowrap;
    }

    .watermark-inside {
      text-align: center;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 4px;
      color: rgba(255, 255, 255, 0.2);
      text-transform: uppercase;
      margin-top: 20px;
      user-select: none;
    }
  </style>
</head>
<body>

  <!-- Name Modal -->
  <div class="modal-overlay" id="nameModal">
    <div class="modal-card">
      <h2 style="font-size:20px; font-weight:700; margin-bottom:8px;">Welcome to QuickDrop</h2>
      <p style="font-size:13px; color:var(--text-muted); margin-bottom:20px;">Please enter your name to personalize your file transfers.</p>
      <input type="text" id="userNameInput" class="path-input" placeholder="Your Name (e.g. Alex)" onkeydown="if(event.key==='Enter') saveUserName()" style="text-align:center; font-size:15px; margin-bottom:20px; color:white;">
      <button type="button" class="btn" onclick="saveUserName()">Continue to App</button>
      <div style="margin-top:14px; font-size:12px; color:var(--text-muted); cursor:pointer; text-decoration:underline;" onclick="skipOnboarding()">Skip for now &rarr;</div>
    </div>
  </div>

  <!-- Background Watermark -->
  <div class="watermark-bg">HAVE PATIENCE</div>

  <div class="container">
    <div class="header">
      <div class="brand-col">
        <div class="brand">QuickDrop</div>
        <div class="greeting" id="greetingText">Hi User</div>
      </div>
      <div class="connection-badge" id="connBadge">
        <div class="dot"></div>
        <span id="connText">Target PC: ${pcName}</span>
      </div>
    </div>

    <!-- Prominent Visible "HAVE PATIENCE" Banner -->
    <div class="patience-banner">⏳ HAVE PATIENCE</div>

    <div class="tabs">
      <div class="tab active" id="tabSend" onclick="switchTab('send')">Send Files</div>
      <div class="tab" id="tabReceive" onclick="switchTab('receive')">Receive / Storage Settings</div>
    </div>

    <!-- Send Panel (iPhone / Mobile / Browser to Windows) -->
    <div class="panel" id="panelSend">
      <h3 style="font-size:16px; margin-bottom:6px;">Select Files to Share</h3>
      <p style="font-size:13px; color:var(--text-muted); margin-bottom:12px;">Direct high-speed transfer to PC (${pcName})</p>
      
      <!-- Lossless Quality Notice -->
      <div style="font-size:12px; color:var(--text-muted); margin-bottom:16px; display:flex; align-items:center; gap:6px;">
        <span style="color:#10B981; font-weight:700;">🛡️ 100% Lossless Quality:</span> Streamed bitwise — zero image compression, zero re-encoding.
      </div>

      <input type="file" id="fileInput" multiple style="display:none;" onchange="onFilesPicked()">
      <button type="button" class="btn btn-secondary" style="width:100%; padding:14px; margin-bottom:12px;" onclick="document.getElementById('fileInput').click()">Choose Files from Device (iPhone/Android/PC)</button>

      <div class="file-box" id="fileBox">No files selected</div>

      <button type="button" class="btn" id="sendBtn" onclick="startUpload()">Send Selected Files</button>

      <div class="progress-track" id="progressTrack"><div class="progress-fill" id="progressFill"></div></div>
      <div class="status-text" id="statusText"></div>

      <!-- Success Card -->
      <div class="success-card" id="transferSuccessCard">
        <div class="success-title">🎉 Transfer Successful! (100% Lossless)</div>
        <div class="success-path" id="successPathText">Files received successfully.</div>
        <div id="successDownloadContainer" style="margin-top:10px;"></div>
      </div>

      <div class="watermark-inside">⏳ HAVE PATIENCE</div>
    </div>

    <!-- Receive / Storage Settings Panel -->
    <div class="panel" id="panelReceive" style="display:none;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
        <h3 style="font-size:16px;">Receive Mode & Target Storage</h3>
        <button type="button" class="btn-secondary btn-accent" onclick="loadStatusAndHistory()" style="padding:6px 12px; font-size:12px; font-weight:700;">🔄 Refresh Status</button>
      </div>

      <!-- Instructions Banner -->
      <div style="background:rgba(79,70,229,0.1); border:1px solid rgba(79,70,229,0.3); border-radius:10px; padding:12px; margin-bottom:16px; font-size:12px; line-height:1.5;">
        <b>💡 How to Get Received Files onto Your PC:</b><br>
        • <b>When using Render Cloud (quickdrop-vx8z.onrender.com):</b> Select any or all files below and click <b style="color:#10B981;">📥 Download Selected Files</b> to save them to your PC's Downloads folder.<br>
        • <b>When running locally on PC:</b> Connect your phone directly to your PC's IP address (<code style="color:var(--accent);">http://${localIp}:${PORT}</code>) over local Wi-Fi to save files directly into your Windows folder.
      </div>

      <!-- Target Storage Location Settings (Only in Receiving Section) -->
      <div class="save-location-card">
        <div class="save-label">
          <span>📂 Target Save Location on PC</span>
          <span style="color:var(--accent); font-weight:600;">Default Priority: D: &rarr; C: &rarr; Desktop</span>
        </div>
        <div class="path-row">
          <input type="text" class="path-input" id="activeSaveDirDisplay" value="${escapedSaveDir}">
          <button type="button" class="btn-secondary" onclick="triggerNativeFolderPicker()" title="Browse folder using Windows File Explorer">📂 Select Folder</button>
        </div>
        <button type="button" class="btn-secondary" style="width:100%; font-size:13px;" onclick="updateSavePathFromInput()">Set Target Folder Path</button>
      </div>

      <div class="info-row">
        <span style="color:var(--text-muted);">PC Device Name</span>
        <span style="font-weight:600;">${pcName}</span>
      </div>
      <div class="info-row">
        <span style="color:var(--text-muted);">Local Wi-Fi IP</span>
        <span style="font-weight:600;">${localIp}:${PORT}</span>
      </div>

      <div style="margin-top:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <h4 style="font-size:14px;">Recent Received Files</h4>
          <button type="button" class="btn-secondary" style="font-size:12px; padding:6px 12px; font-weight:600;" onclick="loadStatusAndHistory()">🔄 Refresh History</button>
        </div>

        <!-- Select All & Batch Download Bar -->
        <div id="batchActionBox" style="display:none; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.03); border:1px solid var(--card-border); border-radius:10px; padding:10px 14px; margin-bottom:14px;">
          <label style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:600; cursor:pointer;">
            <input type="checkbox" id="selectAllCb" onchange="toggleSelectAll(this)" style="width:16px; height:16px; cursor:pointer;"> Select All Files
          </label>
          <button type="button" class="btn-secondary btn-accent" style="font-size:12px; padding:6px 14px; font-weight:700;" onclick="downloadAllSelected()">📥 Download Selected Files</button>
        </div>

        <div id="historyList" style="font-size:13px; color:var(--text-muted);">Fetching history...</div>
      </div>

      <div class="watermark-inside">⏳ HAVE PATIENCE</div>
    </div>
  </div>

  <script>
    const compliments = ['Awesome', 'Brilliant', 'Superstar', 'Wonderful', 'Legendary', 'Creative', 'Incredible', 'Fantastic', 'Amazing'];
    let globalHistoryList = [];
    
    function getStoredUserName() {
      try { return localStorage.getItem('quickdrop_user_name') || ''; } catch(e) { return ''; }
    }
    function setStoredUserName(val) {
      try { localStorage.setItem('quickdrop_user_name', val); } catch(e) {}
    }

    let currentUserName = getStoredUserName();
    let lastSavedPath = '';
    let lastFileId = '';

    function initUserOnboarding() {
      const modal = document.getElementById('nameModal');
      if (!currentUserName) {
        if (modal) modal.style.display = 'flex';
      } else {
        if (modal) modal.style.display = 'none';
        displayGreeting();
      }
    }

    function saveUserName() {
      const input = document.getElementById('userNameInput');
      const inputVal = input ? input.value.trim() : '';
      currentUserName = inputVal || 'Friend';
      setStoredUserName(currentUserName);
      closeNameModal();
      displayGreeting();
    }

    function skipOnboarding() {
      currentUserName = 'Friend';
      closeNameModal();
      displayGreeting();
    }

    function closeNameModal() {
      const modal = document.getElementById('nameModal');
      if (modal) modal.style.display = 'none';
    }

    function displayGreeting() {
      const randomComp = compliments[Math.floor(Math.random() * compliments.length)];
      const greetingEl = document.getElementById('greetingText');
      if (greetingEl) {
        greetingEl.innerHTML = 'Hi ' + randomComp + ' <span>' + escapeHtml(currentUserName) + '</span>';
      }
    }

    function switchTab(mode) {
      const tabSend = document.getElementById('tabSend');
      const tabReceive = document.getElementById('tabReceive');
      const panelSend = document.getElementById('panelSend');
      const panelReceive = document.getElementById('panelReceive');

      if (tabSend) tabSend.classList.toggle('active', mode === 'send');
      if (tabReceive) tabReceive.classList.toggle('active', mode === 'receive');
      if (panelSend) panelSend.style.display = mode === 'send' ? 'block' : 'none';
      if (panelReceive) panelReceive.style.display = mode === 'receive' ? 'block' : 'none';
      
      if (mode === 'receive') {
        loadStatusAndHistory();
      }
    }

    // Trigger Windows Native Folder Selection Dialog
    async function triggerNativeFolderPicker() {
      try {
        const res = await fetch('/api/select-folder', { method: 'POST' });
        const data = await res.json();
        if (data.success && data.activeSaveDir) {
          const display = document.getElementById('activeSaveDirDisplay');
          if (display) display.value = data.activeSaveDir;
          alert('Save folder updated to: ' + data.activeSaveDir);
        } else if (data.error) {
          alert('Folder selection: ' + data.error);
        }
      } catch (e) {
        alert('Could not trigger folder picker: ' + e.message);
      }
    }

    // Update path manually from text input
    async function updateSavePathFromInput() {
      const display = document.getElementById('activeSaveDirDisplay');
      const pathVal = display ? display.value : '';
      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activeSaveDir: pathVal })
        });
        const data = await res.json();
        if (data.success) {
          alert('Target folder updated to: ' + data.activeSaveDir);
        }
      } catch (e) {
        alert('Error updating path: ' + e.message);
      }
    }

    function toggleSelectAll(masterCb) {
      const checkboxes = document.querySelectorAll('.file-select-cb');
      checkboxes.forEach(cb => cb.checked = masterCb.checked);
    }

    function downloadAllSelected() {
      const checkboxes = document.querySelectorAll('.file-select-cb:checked');
      if (!checkboxes || checkboxes.length === 0) {
        alert('Please check at least one file to download.');
        return;
      }
      
      checkboxes.forEach((cb, idx) => {
        setTimeout(() => {
          const id = cb.getAttribute('data-id');
          if (id) {
            const a = document.createElement('a');
            a.href = '/download?id=' + encodeURIComponent(id);
            a.download = '';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          }
        }, idx * 300); // 300ms delay to prevent browser download popup blocking
      });
    }

    function onFilesPicked() {
      const input = document.getElementById('fileInput');
      const box = document.getElementById('fileBox');
      if (input && input.files && input.files.length > 0) {
        let total = 0;
        let html = '<b>Selected (' + input.files.length + ' files):</b><br>';
        for (let i = 0; i < input.files.length; i++) {
          total += input.files[i].size;
          html += '&bull; ' + escapeHtml(input.files[i].name) + ' (' + (input.files[i].size / 1024 / 1024).toFixed(1) + ' MB)<br>';
        }
        html += '<br><b>Total Size: ' + (total / 1024 / 1024).toFixed(1) + ' MB</b>';
        box.innerHTML = html;
      } else if (box) {
        box.innerHTML = 'No files selected';
      }
    }

    async function startUpload() {
      const input = document.getElementById('fileInput');
      if (!input || !input.files || !input.files.length) {
        alert('Please click [Choose Files from Device] first.');
        return;
      }

      const files = Array.from(input.files);
      const track = document.getElementById('progressTrack');
      const fill = document.getElementById('progressFill');
      const status = document.getElementById('statusText');
      const sendBtn = document.getElementById('sendBtn');
      const successCard = document.getElementById('transferSuccessCard');
      const successPathText = document.getElementById('successPathText');
      const dlContainer = document.getElementById('successDownloadContainer');
      
      if (track) track.style.display = 'block';
      if (successCard) successCard.style.display = 'none';
      if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.style.opacity = '0.5';
      }

      let totalSize = files.reduce((acc, f) => acc + f.size, 0);
      let totalUploaded = 0;
      const startTime = Date.now();

      try {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          if (status) {
            status.innerText = 'Transferring [' + (i + 1) + '/' + files.length + ']: ' + file.name;
            status.style.color = '#F3F4F6';
          }

          const resData = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/upload', true);
            xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
            xhr.setRequestHeader('X-File-Size', file.size);
            xhr.setRequestHeader('X-Sender-Name', currentUserName || 'Client Device');

            let lastLoaded = 0;
            xhr.upload.onprogress = (e) => {
              if (e.lengthComputable) {
                const delta = e.loaded - lastLoaded;
                lastLoaded = e.loaded;
                totalUploaded += delta;

                const pct = Math.round((totalUploaded / totalSize) * 100);
                const elapsedSec = (Date.now() - startTime) / 1000;
                const speedMBps = elapsedSec > 0 ? ((totalUploaded / 1024 / 1024) / elapsedSec).toFixed(1) : 0;

                if (fill) fill.style.width = pct + '%';
                if (status) status.innerText = 'Transferring: ' + pct + '% (' + speedMBps + ' MB/s)';
              }
            };

            xhr.onload = () => {
              if (xhr.status === 200) {
                try { resolve(JSON.parse(xhr.responseText)); } catch (e) { resolve({}); }
              } else reject(new Error('Upload failed'));
            };
            xhr.onerror = () => reject(new Error('Network error'));
            xhr.send(file);
          });

          if (resData && resData.savedPath) {
            lastSavedPath = resData.savedPath;
            if (resData.fileId) lastFileId = resData.fileId;
          }
        }

        if (fill) fill.style.width = '100%';
        if (status) {
          status.innerText = 'Transfer Complete! (100% Lossless)';
          status.style.color = '#10B981';
        }

        if (successCard) successCard.style.display = 'block';
        if (successPathText) {
          if (lastSavedPath) {
            successPathText.innerHTML = '<b>Full Saved Path:</b> <code style="color:#10B981; word-break:break-all;">' + escapeHtml(lastSavedPath) + '</code>';
          } else {
            successPathText.innerText = 'Saved in target QuickDrop folder.';
          }
        }
        if (dlContainer && lastFileId) {
          dlContainer.innerHTML = '<a href="/download?id=' + encodeURIComponent(lastFileId) + '" download class="btn-secondary btn-accent" style="width:100%; font-size:13px;">📥 Download File to PC</a>';
        }
      } catch (err) {
        if (status) {
          status.innerText = 'Error: ' + err.message;
          status.style.color = '#EF4444';
        }
      } finally {
        if (sendBtn) {
          sendBtn.disabled = false;
          sendBtn.style.opacity = '1.0';
        }
      }
    }

    async function loadStatusAndHistory() {
      try {
        const res = await fetch('/status');
        const data = await res.json();
        
        if (data.activeSaveDir) {
          const display = document.getElementById('activeSaveDirDisplay');
          if (display) display.value = data.activeSaveDir;
        }

        if (data.connectedClient) {
          const connText = document.getElementById('connText');
          if (connText) connText.innerText = 'Connected: ' + data.connectedClient.name;
        }

        const histList = document.getElementById('historyList');
        const batchBox = document.getElementById('batchActionBox');

        if (histList) {
          if (data.history && data.history.length > 0) {
            globalHistoryList = data.history;
            if (batchBox) batchBox.style.display = 'flex';
            let html = '';
            data.history.forEach((item) => {
              const fullSavedPath = item.finalPath || item.tempPath || data.activeSaveDir || '';
              html += '<div style="padding:14px; margin-bottom:12px; background:rgba(255,255,255,0.02); border:1px solid var(--card-border); border-radius:12px; display:flex; gap:12px; align-items:flex-start;">' +
                      '<input type="checkbox" class="file-select-cb" data-id="' + escapeHtml(item.id) + '" style="width:18px; height:18px; margin-top:3px; cursor:pointer;" title="Select file for batch download">' +
                      '<div style="flex:1;">' +
                      '<div style="font-weight:700; color:white; font-size:14px; margin-bottom:4px;">' + escapeHtml(item.fileName) + ' <span style="font-weight:400; font-size:12px; color:var(--text-muted);">(' + (item.fileSize / 1024 / 1024).toFixed(1) + ' MB)</span></div>' +
                      '<div style="font-size:12px; color:var(--accent); word-break:break-all; margin-bottom:8px;"><b>Full Saved Path:</b> ' + escapeHtml(fullSavedPath) + '</div>' +
                      '<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">' +
                      '<span style="font-size:11px; color:var(--text-muted);">' + escapeHtml(item.time) + ' &bull; ' + escapeHtml(item.senderName || 'Device') + '</span>' +
                      '<a href="/download?id=' + encodeURIComponent(item.id) + '" download class="btn-secondary btn-accent" style="font-size:12px; padding:6px 12px;">📥 Download File to PC</a>' +
                      '</div></div></div>';
            });
            histList.innerHTML = html;
          } else {
            if (batchBox) batchBox.style.display = 'none';
            histList.innerHTML = 'No files received yet.';
          }
        }
      } catch (e) {}
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    // Initialize Onboarding & Status
    initUserOnboarding();
    loadStatusAndHistory();
  </script>
</body>
</html>
    `);
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[QuickDrop Server] Running on http://${localIp}:${PORT}`);
  console.log(`[Save Path] Default target: ${activeSaveDir}`);
});
