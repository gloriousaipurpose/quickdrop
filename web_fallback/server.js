/**
 * QuickDrop Premium Minimalist File Sharing Server
 * Features: Name Onboarding, Random Unisex Compliments, Auto Save & Multi-File Transfer
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const dgram = require('dgram');

const PORT = process.env.PORT || 8080;
const UDP_PORT = 41234;

function getDefaultSaveDir() {
  const dDrivePath = 'D:\\QuickDrop';
  try {
    if (fs.existsSync('D:\\')) {
      if (!fs.existsSync(dDrivePath)) {
        fs.mkdirSync(dDrivePath, { recursive: true });
      }
      return dDrivePath;
    }
  } catch (e) {}

  const fallbackPath = path.join(os.homedir(), 'Downloads', 'QuickDrop');
  if (!fs.existsSync(fallbackPath)) {
    fs.mkdirSync(fallbackPath, { recursive: true });
  }
  return fallbackPath;
}

let activeSaveDir = getDefaultSaveDir();
let autoSaveToLastPath = true;
const tempDir = path.join(activeSaveDir, '.temp');

if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
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

// UDP Advertiser (Local Wi-Fi)
try {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  socket.bind(UDP_PORT, () => {
    socket.setBroadcast(true);
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
} catch (e) {
  // Graceful fallback for cloud hosting without raw UDP broadcast
}

function moveTempToFinal(tempFilePath, fileName, targetFolder) {
  if (!fs.existsSync(targetFolder)) {
    fs.mkdirSync(targetFolder, { recursive: true });
  }
  const destPath = path.join(targetFolder, fileName);
  fs.renameSync(tempFilePath, destPath);
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

  if (req.url === '/status' || req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'Ready to receive',
      name: pcName,
      ip: localIp,
      activeSaveDir: activeSaveDir,
      autoSaveToLastPath: autoSaveToLastPath,
      connectedClient: lastConnectedClient,
      history: transferHistory,
      pendingCount: pendingReceivedFiles.length,
    }));
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

  // Upload Endpoint
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
        message: 'File received successfully',
        saved: fileItem.saved,
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

  // Unified Premium Minimalist UI with Name Onboarding & Unisex Compliment Greeting
  if (req.url === '/' || req.url === '/index.html') {
    const escapedSaveDir = activeSaveDir.replace(/\\/g, '\\\\');

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
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
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); padding: 24px 16px; min-height: 100vh; display: flex; flex-direction: column; align-items: center; }
    .container { width: 100%; max-width: 520px; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--card-border); }
    .brand-col { display: flex; flex-direction: column; }
    .brand { font-size: 20px; font-weight: 700; letter-spacing: -0.5px; }
    .greeting { font-size: 13px; color: var(--text-muted); font-weight: 500; margin-top: 2px; }
    .greeting span { color: var(--text); font-weight: 600; }
    .connection-badge { font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 20px; background: rgba(16, 185, 129, 0.1); color: var(--accent); border: 1px solid rgba(16, 185, 129, 0.2); display: flex; align-items: center; gap: 6px; }
    .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
    .tabs { display: flex; background: var(--card); padding: 4px; border-radius: 12px; border: 1px solid var(--card-border); margin-bottom: 20px; }
    .tab { flex: 1; padding: 12px; text-align: center; font-size: 14px; font-weight: 600; color: var(--text-muted); border-radius: 8px; cursor: pointer; transition: all 0.2s; }
    .tab.active { background: var(--primary); color: white; }
    .panel { background: var(--card); border-radius: 16px; border: 1px solid var(--card-border); padding: 24px; margin-bottom: 20px; }
    .btn { background: var(--primary); color: white; border: none; padding: 14px 20px; border-radius: 10px; font-weight: 600; font-size: 15px; cursor: pointer; width: 100%; transition: background 0.2s; }
    .btn:hover { background: var(--primary-hover); }
    .btn-secondary { background: rgba(255, 255, 255, 0.05); color: var(--text); border: 1px solid var(--card-border); margin-bottom: 12px; }
    .btn-secondary:hover { background: rgba(255, 255, 255, 0.1); }
    .file-box { background: var(--bg); border-radius: 10px; padding: 14px; margin: 14px 0; font-size: 13px; color: var(--text-muted); border: 1px dashed var(--card-border); line-height: 1.5; word-break: break-word; }
    .progress-track { background: rgba(255, 255, 255, 0.05); height: 10px; border-radius: 5px; overflow: hidden; margin: 16px 0; display: none; }
    .progress-fill { background: var(--primary); height: 100%; width: 0%; transition: width 0.1s; }
    .status-text { font-size: 14px; font-weight: 600; text-align: center; margin-top: 8px; }
    .info-row { display: flex; justify-content: space-between; font-size: 13px; padding: 8px 0; border-bottom: 1px solid var(--card-border); }
    .path-input { width: 100%; background: var(--bg); border: 1px solid var(--card-border); color: white; padding: 10px; border-radius: 8px; margin: 8px 0 16px 0; font-size: 13px; }

    /* Name Onboarding Modal */
    .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(9, 13, 22, 0.9); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; z-index: 999; }
    .modal-card { background: var(--card); border: 1px solid var(--card-border); border-radius: 20px; padding: 32px 24px; width: 90%; max-width: 400px; text-align: center; }
  </style>
</head>
<body>

  <!-- Name Onboarding Modal -->
  <div class="modal-overlay" id="nameModal">
    <div class="modal-card">
      <h2 style="font-size:20px; font-weight:700; margin-bottom:8px;">Welcome to QuickDrop</h2>
      <p style="font-size:13px; color:var(--text-muted); margin-bottom:20px;">Please enter your name to personalize your file sharing experience.</p>
      <input type="text" id="userNameInput" class="path-input" placeholder="Your Name (e.g. Alex)" style="text-align:center; font-size:15px; margin-bottom:20px;">
      <button class="btn" onclick="saveUserName()">Continue to App</button>
    </div>
  </div>

  <div class="container">
    <div class="header">
      <div class="brand-col">
        <div class="brand">QuickDrop</div>
        <div class="greeting" id="greetingText">Hi User</div>
      </div>
      <div class="connection-badge" id="connBadge">
        <div class="dot"></div>
        <span id="connText">Connected to PC: ${pcName}</span>
      </div>
    </div>

    <div class="tabs">
      <div class="tab active" id="tabSend" onclick="switchTab('send')">Send Files</div>
      <div class="tab" id="tabReceive" onclick="switchTab('receive')">Receive Mode</div>
    </div>

    <!-- Send Panel -->
    <div class="panel" id="panelSend">
      <h3 style="font-size:16px; margin-bottom:6px;">Select Files to Share</h3>
      <p style="font-size:13px; color:var(--text-muted); margin-bottom:16px;">Direct high-speed stream to ${pcName}</p>
      
      <input type="file" id="fileInput" multiple style="display:none;" onchange="onFilesPicked()">
      <button class="btn btn-secondary" onclick="document.getElementById('fileInput').click()">Choose Files from Device</button>

      <div class="file-box" id="fileBox">No files selected</div>

      <button class="btn" id="sendBtn" onclick="startUpload()">Send Selected Files</button>

      <div class="progress-track" id="progressTrack"><div class="progress-fill" id="progressFill"></div></div>
      <div class="status-text" id="statusText"></div>
    </div>

    <!-- Receive Panel -->
    <div class="panel" id="panelReceive" style="display:none;">
      <h3 style="font-size:16px; margin-bottom:6px;">Receive Mode Settings</h3>
      <p style="font-size:13px; color:var(--text-muted); margin-bottom:16px;">Configure storage target for incoming transfers.</p>
      
      <div class="info-row">
        <span style="color:var(--text-muted);">PC Device Name</span>
        <span style="font-weight:600;">${pcName}</span>
      </div>
      <div class="info-row">
        <span style="color:var(--text-muted);">Local Wi-Fi IP</span>
        <span style="font-weight:600;">${localIp}:${PORT}</span>
      </div>
      
      <div style="margin-top:16px;">
        <label style="font-size:13px; font-weight:600;">Target Save Path on PC:</label>
        <input type="text" class="path-input" id="saveDirInput" value="${escapedSaveDir}">
        <button class="btn btn-secondary" onclick="updateSavePath()">Update Save Path</button>
      </div>

      <div style="margin-top:16px;">
        <h4 style="font-size:14px; margin-bottom:8px;">Recent Received Transfers</h4>
        <div id="historyList" style="font-size:13px; color:var(--text-muted);">Fetching history...</div>
      </div>
    </div>
  </div>

  <script>
    const compliments = [
      'Awesome', 'Brilliant', 'Superstar', 'Wonderful', 
      'Legendary', 'Creative', 'Incredible', 'Fantastic', 'Amazing'
    ];

    let currentUserName = localStorage.getItem('quickdrop_user_name') || '';

    function initUserOnboarding() {
      if (!currentUserName) {
        document.getElementById('nameModal').style.display = 'flex';
      } else {
        document.getElementById('nameModal').style.display = 'none';
        displayGreeting();
      }
    }

    function saveUserName() {
      const inputVal = document.getElementById('userNameInput').value.trim();
      if (!inputVal) return alert('Please enter your name.');
      currentUserName = inputVal;
      localStorage.setItem('quickdrop_user_name', currentUserName);
      document.getElementById('nameModal').style.display = 'none';
      displayGreeting();
    }

    function displayGreeting() {
      const randomComp = compliments[Math.floor(Math.random() * compliments.length)];
      document.getElementById('greetingText').innerHTML = 'Hi ' + randomComp + ' <span>' + currentUserName + '</span>';
    }

    function switchTab(mode) {
      document.getElementById('tabSend').classList.toggle('active', mode === 'send');
      document.getElementById('tabReceive').classList.toggle('active', mode === 'receive');
      document.getElementById('panelSend').style.display = mode === 'send' ? 'block' : 'none';
      document.getElementById('panelReceive').style.display = mode === 'receive' ? 'block' : 'none';
      
      if (mode === 'receive') {
        loadStatusAndHistory();
      }
    }

    function onFilesPicked() {
      const input = document.getElementById('fileInput');
      const box = document.getElementById('fileBox');
      if (input.files && input.files.length > 0) {
        let total = 0;
        let html = '<b>Selected (' + input.files.length + ' files):</b><br>';
        for (let i = 0; i < input.files.length; i++) {
          total += input.files[i].size;
          html += '&bull; ' + input.files[i].name + ' (' + (input.files[i].size / 1024 / 1024).toFixed(1) + ' MB)<br>';
        }
        html += '<br><b>Total Size: ' + (total / 1024 / 1024).toFixed(1) + ' MB</b>';
        box.innerHTML = html;
      } else {
        box.innerHTML = 'No files selected';
      }
    }

    async function startUpload() {
      const input = document.getElementById('fileInput');
      if (!input.files || !input.files.length) {
        alert('Please click [Choose Files from Device] first.');
        return;
      }

      const files = Array.from(input.files);
      const track = document.getElementById('progressTrack');
      const fill = document.getElementById('progressFill');
      const status = document.getElementById('statusText');
      const sendBtn = document.getElementById('sendBtn');
      
      track.style.display = 'block';
      sendBtn.disabled = true;
      sendBtn.style.opacity = '0.5';

      let totalSize = files.reduce((acc, f) => acc + f.size, 0);
      let totalUploaded = 0;
      const startTime = Date.now();

      try {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          status.innerText = 'Transferring [' + (i + 1) + '/' + files.length + ']: ' + file.name;
          status.style.color = '#F3F4F6';

          await new Promise((resolve, reject) => {
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

                fill.style.width = pct + '%';
                status.innerText = 'Transferring: ' + pct + '% (' + speedMBps + ' MB/s)';
              }
            };

            xhr.onload = () => {
              if (xhr.status === 200) resolve();
              else reject(new Error('Upload failed'));
            };
            xhr.onerror = () => reject(new Error('Network error'));
            xhr.send(file);
          });
        }

        fill.style.width = '100%';
        status.innerText = 'Transfer Complete';
        status.style.color = '#10B981';
      } catch (err) {
        status.innerText = 'Error: ' + err.message;
        status.style.color = '#EF4444';
      } finally {
        sendBtn.disabled = false;
        sendBtn.style.opacity = '1.0';
      }
    }

    async function updateSavePath() {
      const pathVal = document.getElementById('saveDirInput').value;
      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activeSaveDir: pathVal })
        });
        const data = await res.json();
        if (data.success) {
          alert('Save directory updated to: ' + data.activeSaveDir);
        }
      } catch (e) {
        alert('Error updating path: ' + e.message);
      }
    }

    async function loadStatusAndHistory() {
      try {
        const res = await fetch('/status');
        const data = await res.json();
        
        if (data.connectedClient) {
          document.getElementById('connText').innerText = 'Connected: ' + data.connectedClient.name;
        }

        const histList = document.getElementById('historyList');
        if (data.history && data.history.length > 0) {
          let html = '';
          data.history.forEach(item => {
            html += '<div style="padding:6px 0; border-bottom:1px solid var(--card-border);">&bull; ' + 
                    item.fileName + ' (' + (item.fileSize / 1024 / 1024).toFixed(1) + ' MB) &mdash; ' + item.time + '</div>';
          });
          histList.innerHTML = html;
        } else {
          histList.innerHTML = 'No files received yet.';
        }
      } catch (e) {}
    }

    // Initialize onboarding & greeting
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
