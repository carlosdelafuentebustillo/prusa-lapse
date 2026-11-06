const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const http = require('http');
const net = require('net');
const { fork } = require('child_process');
const fs = require('fs');

let mainWindow = null;
let serverProcess = null;
let activePort = 3000;

// Helper: Check if a TCP port is free
function getFreePort(startPort) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => {
      resolve(getFreePort(startPort + 1));
    });
    server.listen(startPort, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

// Helper: Poll server until ready
function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(url, (res) => {
        if (res.statusCode === 200 || res.statusCode === 404 || res.statusCode === 304) {
          resolve();
        } else {
          retry();
        }
      });
      req.on('error', retry);
      req.setTimeout(1000, () => {
        req.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error('Server start timed out after ' + timeoutMs + 'ms'));
      } else {
        setTimeout(check, 100);
      }
    };

    check();
  });
}

// Locate Next.js standalone server.js
function findServerScript() {
  const candidates = [
    path.join(__dirname, 'app', 'server.js'),
    path.join(process.resourcesPath, 'app', 'server.js'),
    path.join(__dirname, '..', 'webapp', '.next', 'standalone', 'server.js'),
    path.join(__dirname, 'server.js')
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

// Locate bundled FFmpeg binary
function findFfmpegPath() {
  const isWin = process.platform === 'win32';
  const binName = isWin ? 'ffmpeg.exe' : 'ffmpeg';
  const candidates = [
    path.join(__dirname, 'bin', binName),
    path.join(process.resourcesPath, 'bin', binName),
    path.join(__dirname, '..', 'webapp', 'node_modules', '@ffmpeg-installer', `${process.platform}-${process.arch}`, binName),
    path.join(__dirname, '..', 'webapp', 'node_modules', '@ffmpeg-installer', 'win32-x64', 'ffmpeg.exe')
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'ffmpeg';
}

async function startServer() {
  const serverScript = findServerScript();
  if (!serverScript) {
    throw new Error('Could not locate Next.js standalone server.js script.');
  }

  activePort = await getFreePort(3000);
  console.log(`[Desktop] Starting Next.js server on port ${activePort}...`);
  console.log(`[Desktop] Script: ${serverScript}`);

  const serverDir = path.dirname(serverScript);
  const ffmpegPath = findFfmpegPath();

  const userDataDir = app.getPath('userData');
  const userCapturesDir = path.join(userDataDir, 'captures');
  const userConfigFile = path.join(userDataDir, 'prusa-lapse.config.json');

  try {
    if (!fs.existsSync(userCapturesDir)) {
      fs.mkdirSync(userCapturesDir, { recursive: true });
    }
  } catch (e) {}

  // Auto-seed userConfigFile if it doesn't exist yet
  if (!fs.existsSync(userConfigFile)) {
    const candidateConfigs = [
      path.join(serverDir, 'prusa-lapse.config.json'),
      path.join(__dirname, 'prusa-lapse.config.json'),
      path.join(__dirname, '..', 'webapp', 'prusa-lapse.config.json')
    ];
    for (const cc of candidateConfigs) {
      if (fs.existsSync(cc) && fs.statSync(cc).size > 10) {
        try {
          fs.copyFileSync(cc, userConfigFile);
          break;
        } catch (e) {}
      }
    }
  }

  const env = Object.assign({}, process.env, {
    PORT: activePort.toString(),
    HOSTNAME: '127.0.0.1',
    NODE_ENV: 'production',
    ELECTRON_RUN_AS_NODE: '1',
    FFMPEG_PATH: ffmpegPath,
    PRUSALAPSE_CONFIG_FILE: userConfigFile,
    PRUSALAPSE_CAPTURES_DIR: userCapturesDir
  });

  serverProcess = fork(serverScript, [], {
    cwd: serverDir,
    env: env,
    stdio: 'inherit'
  });

  serverProcess.on('error', (err) => {
    console.error('[Desktop] Server process error:', err);
  });

  serverProcess.on('exit', (code, signal) => {
    console.log(`[Desktop] Server process exited with code ${code}, signal ${signal}`);
  });

  const checkUrl = `http://127.0.0.1:${activePort}/api/config`;
  console.log(`[Desktop] Waiting for server at ${checkUrl}...`);
  await waitForServer(checkUrl, 15000);
  console.log('[Desktop] Server is ready!');
}

function createWindow() {
  const iconPath = process.platform === 'win32'
    ? path.join(__dirname, 'icon.ico')
    : path.join(__dirname, 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    title: 'PrusaLapse',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    backgroundColor: '#121417',
    autoHideMenuBar: true,
    show: false, // Show once ready-to-show to prevent white flash
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadURL(`http://127.0.0.1:${activePort}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open external links in user's default browser (e.g. Prusa Connect, guides)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://127.0.0.1:${activePort}`) && !url.startsWith(`http://localhost:${activePort}`)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      await startServer();
      createWindow();
    } catch (err) {
      console.error('[Desktop] Initialization error:', err);
      const { dialog } = require('electron');
      dialog.showErrorBox('PrusaLapse Startup Error', err.message || 'Failed to start PrusaLapse server.');
      app.quit();
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('will-quit', () => {
    if (serverProcess) {
      console.log('[Desktop] Shutting down background server process...');
      try {
        serverProcess.kill();
      } catch (e) {}
      serverProcess = null;
    }
  });
}
