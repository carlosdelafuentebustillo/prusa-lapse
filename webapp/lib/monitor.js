import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { existsSync, createWriteStream } from 'fs';
import * as tar from 'tar';

function getDefaultDataDir() {
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'PrusaLapse');
  }
  if (process.platform === 'darwin' && process.env.HOME) {
    return path.join(process.env.HOME, 'Library', 'Application Support', 'PrusaLapse');
  }
  if (process.platform === 'linux' && (process.env.XDG_CONFIG_HOME || process.env.HOME)) {
    return path.join(process.env.XDG_CONFIG_HOME || path.join(process.env.HOME, '.config'), 'PrusaLapse');
  }
  return null;
}

function isSystemOrReadOnlyDirectory(dirPath) {
  if (!dirPath) return false;
  const p = path.resolve(dirPath).toLowerCase();
  if (process.platform === 'win32') {
    const progFiles = (process.env.ProgramFiles || 'C:\\Program Files').toLowerCase();
    const progFilesX86 = (process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)').toLowerCase();
    return p.startsWith(progFiles) || p.startsWith(progFilesX86) || p.includes('program files');
  }
  return p.startsWith('/usr') || p.startsWith('/opt') || p.startsWith('/var');
}

export function getCapturesDir() {
  if (process.env.PRUSALAPSE_CAPTURES_DIR) {
    return process.env.PRUSALAPSE_CAPTURES_DIR;
  }
  if (isSystemOrReadOnlyDirectory(process.cwd())) {
    const defaultData = getDefaultDataDir();
    if (defaultData) {
      return path.join(defaultData, 'captures');
    }
  }
  return path.join(process.cwd(), 'public', 'captures');
}

export function getConfigFile() {
  if (process.env.PRUSALAPSE_CONFIG_FILE) {
    return process.env.PRUSALAPSE_CONFIG_FILE;
  }
  if (isSystemOrReadOnlyDirectory(process.cwd())) {
    const defaultData = getDefaultDataDir();
    if (defaultData) {
      return path.join(defaultData, 'prusa-lapse.config.json');
    }
  }
  return path.join(process.cwd(), 'prusa-lapse.config.json');
}

const CAPTURES_DIR = getCapturesDir();

const DEFAULT_SLICER_CONFIG = {
  autoInjectOrcaSlicer: true,
  parkX: 240.0,
  parkY: 210.0,
  zHopHeight: 0.4,
  settleTime: 300,
  captureTime: 1200
};

function getFFmpegPath() {
  // 1. Explicit environment variable override
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }

  const platform = process.platform;
  const arch = process.arch;
  let platformDir = '';
  let binaryName = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

  if (platform === 'win32') {
    platformDir = `win32-${arch}`;
  } else if (platform === 'darwin') {
    platformDir = `darwin-${arch}`;
  } else if (platform === 'linux') {
    platformDir = `linux-${arch}`;
  }

  // 2. Portable distribution bin/ directory (e.g. ./bin/ffmpeg.exe or ../bin/ffmpeg.exe)
  const portableBin = path.join(process.cwd(), 'bin', binaryName);
  if (existsSync(portableBin)) return portableBin;
  const parentBin = path.join(process.cwd(), '..', 'bin', binaryName);
  if (existsSync(parentBin)) return parentBin;

  // 3. Bundled @ffmpeg-installer package in node_modules
  const explicitWinPath = path.join(process.cwd(), 'node_modules', '@ffmpeg-installer', 'win32-x64', 'ffmpeg.exe');
  if (platform === 'win32' && existsSync(explicitWinPath)) {
    return explicitWinPath;
  }

  const localPath = path.join(
    process.cwd(),
    'node_modules',
    '@ffmpeg-installer',
    platformDir,
    binaryName
  );
  if (platformDir && existsSync(localPath)) {
    return localPath;
  }
  
  // 4. Fallback to nested node_modules
  const nestedPath = path.join(process.cwd(), 'node_modules', '@ffmpeg-installer', 'ffmpeg', 'node_modules', '@ffmpeg-installer', platformDir, binaryName);
  if (platformDir && existsSync(nestedPath)) return nestedPath;

  // 5. Windows installed locations
  if (platform === 'win32') {
    const winCandidates = [
      'C:\\Program Files\\PrusaLapse\\resources\\app\\bin\\ffmpeg.exe',
      'C:\\Program Files\\PrusaLapse\\resources\\bin\\ffmpeg.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'PrusaLapse', 'resources', 'app', 'bin', 'ffmpeg.exe'),
      path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'PrusaLapse', 'resources', 'app', 'bin', 'ffmpeg.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'PrusaLapse', 'resources', 'app', 'bin', 'ffmpeg.exe')
    ];
    for (const cand of winCandidates) {
      if (cand && existsSync(cand)) return cand;
    }
  }

  // 6. Fallback to system PATH (e.g. Linux /usr/bin/ffmpeg or Docker container)
  return 'ffmpeg';
}

// Two recordings of the same print job only count as the same timelapse if their start times agree
const START_TIME_TOLERANCE_MS = 10 * 60 * 1000;

function parseSessionTimestampMs(ts) {
  if (!ts || typeof ts !== 'string' || ts.length < 15) return null;
  const ms = new Date(
    parseInt(ts.slice(0, 4), 10), parseInt(ts.slice(4, 6), 10) - 1, parseInt(ts.slice(6, 8), 10),
    parseInt(ts.slice(9, 11), 10), parseInt(ts.slice(11, 13), 10), parseInt(ts.slice(13, 15), 10)
  ).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function startTimesConflict(tsA, tsB) {
  const a = parseSessionTimestampMs(tsA);
  const b = parseSessionTimestampMs(tsB);
  if (a === null || b === null) return false;
  return Math.abs(a - b) > START_TIME_TOLERANCE_MS;
}

function generateSessionTimestamp(date = new Date()) {
  return date.getFullYear() +
    String(date.getMonth() + 1).padStart(2, '0') +
    String(date.getDate()).padStart(2, '0') + '_' +
    String(date.getHours()).padStart(2, '0') +
    String(date.getMinutes()).padStart(2, '0') +
    String(date.getSeconds()).padStart(2, '0');
}

function parsePrusaFilename(displayName = '') {
  if (!displayName) return null;
  const base = displayName.replace(/\.(bgcode|gcode|gco)$/i, '');
  const nozzleMatch = base.match(/_(\d+(?:\.\d+)?n)(?:_|$)/i);
  const layerMatch = base.match(/_(\d+(?:\.\d+)?mm)(?:_|$)/i);
  const materialMatch = base.match(/_(PLA|PETG|ASA|ABS|TPU|FLEX|PC|PVB|PA|HIPS|NYLON|PET|CPE|PP)(?:_|$)/i);
  const timeMatch = base.match(/_((?:\d+d)?(?:\d+h)?(?:\d+m))$/i);

  let modelName = base;
  // Strip standard PrusaSlicer suffix starting at nozzle or layer height
  const suffixIdx = modelName.search(/_(?:\d+(?:\.\d+)?n|\d+(?:\.\d+)?mm)_/i);
  if (suffixIdx > 0) {
    modelName = modelName.substring(0, suffixIdx);
  }
  modelName = modelName.replace(/_/g, ' ').trim();

  return {
    displayName,
    modelName: modelName || base,
    nozzle: nozzleMatch ? nozzleMatch[1] : null,
    layerHeight: layerMatch ? layerMatch[1] : null,
    material: materialMatch ? materialMatch[1].toUpperCase() : null,
    estimatedTime: timeMatch ? timeMatch[1] : null,
  };
}

export function normalizeMacHex(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const clean = raw.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (clean.length === 12) return clean;
  if (clean.length >= 24 && /^[0-9A-F]+$/.test(clean)) {
    return clean.slice(0, 12);
  }
  return null;
}

export function extractCameraMac(data) {
  if (!data || typeof data !== 'object') return null;
  const fromMac = normalizeMacHex(data.mac);
  if (fromMac) return fromMac;
  const fromFp = normalizeMacHex(data.fingerprint);
  if (fromFp) return fromFp;
  return null;
}

export function sanitizeIpForFolder(ip) {
  return String(ip || 'unknown').replace(/[^a-zA-Z0-9]/g, '_');
}

class MonitorService {
  constructor() {
    this.isRunning = false;
    this.logs = [];
    this.intervalId = null;
    this.lastTriggeredTime = 0;
    this.currentSession = null;
    this.frameCount = 0;
    this.remoteFrameCounts = {};
    this.localFrameCounts = {};
    this.isCompiling = false;
    this.fakePrintActive = false;
    this.remoteSessionsCache = [];
    this.fetchStatus = null;
    this.knownCameraMacs = {};
    this.knownCameraNames = {};
    this.knownCameraPrinterStates = {};
    this.log('PrusaLapse Webapp System initialized. Awaiting commands...', 'info');
  }

  getCameraFolderKeySync(ip, config = null, macHint = null) {
    const mac =
      normalizeMacHex(macHint) ||
      normalizeMacHex(this.knownCameraMacs?.[ip]) ||
      normalizeMacHex(config?.cameraMacs?.[ip]);
    if (mac) {
      return `camera_${mac}`;
    }
    if (ip) {
      return `camera_${sanitizeIpForFolder(ip)}`;
    }
    return 'camera_unknown';
  }

  async recordCameraIdentity(ip, data = {}) {
    if (!ip || !data || typeof data !== 'object') return null;
    const mac = extractCameraMac(data);
    const rawName = typeof data.camera_name === 'string' ? data.camera_name.trim() : '';
    const camName = (rawName && rawName !== 'PrusaLapse Camera') ? rawName : null;

    if (mac) this.knownCameraMacs[ip] = mac;
    if (camName) {
      this.knownCameraNames[ip] = camName;
      if (mac) this.knownCameraNames[mac] = camName;
    }

    if (data.printer_state) {
      this.knownCameraPrinterStates[ip] = {
        state: String(data.printer_state).toUpperCase(),
        jobName: data.job_name || null,
        jobId: data.job_id || null,
        updatedAt: Date.now()
      };
    }

    if (!mac && !camName) return null;

    try {
      const config = (await this.getConfig()) || {};
      const cameraMacs = { ...(config.cameraMacs || {}) };
      const cameraNames = { ...(config.cameraNames || {}) };
      let changed = false;

      if (mac && cameraMacs[ip] !== mac) {
        cameraMacs[ip] = mac;
        changed = true;
      }
      if (camName && cameraNames[ip] !== camName) {
        cameraNames[ip] = camName;
        changed = true;
      }
      const effectiveMac = mac || normalizeMacHex(cameraMacs[ip]);
      if (camName && effectiveMac && cameraNames[effectiveMac] !== camName) {
        cameraNames[effectiveMac] = camName;
        changed = true;
      }

      if (changed) {
        const updated = {
          ...config,
          cameraMacs,
          cameraNames
        };
        await fs.writeFile(getConfigFile(), JSON.stringify(updated, null, 2), 'utf-8');
      }
    } catch {}

    return mac;
  }

  async resolveCameraFolderKey(ip, config = null, macHint = null) {
    const cfg = config || (await this.getConfig());
    const initialKey = this.getCameraFolderKeySync(ip, cfg, macHint);
    if (/^camera_[0-9A-F]{12}$/.test(initialKey)) {
      return initialKey;
    }
    if (ip) {
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 2000);
        const res = await fetch(`http://${ip}/status`, { signal: ctrl.signal });
        clearTimeout(tid);
        if (res.ok) {
          const data = await res.json();
          const mac = await this.recordCameraIdentity(ip, data);
          if (mac) return `camera_${mac}`;
        }
      } catch {}
    }
    return initialKey;
  }

  findCameraEntryForIp(cameras, camIp, config = null, sessionMeta = null) {
    if (!Array.isArray(cameras) || !camIp) return null;
    const mac = normalizeMacHex(this.knownCameraMacs?.[camIp]) || normalizeMacHex(config?.cameraMacs?.[camIp]);
    const macFolder = mac ? `camera_${mac}` : null;
    const ipFolder = `camera_${sanitizeIpForFolder(camIp)}`;
    const metaFolder = sessionMeta?.cameraFolders?.[camIp] || null;

    const byFolder = cameras.find(c =>
      (macFolder && c.name === macFolder) ||
      (metaFolder && c.name === metaFolder) ||
      c.name === ipFolder ||
      (mac && c.mac === mac) ||
      c.ip === camIp
    );
    if (byFolder) return byFolder;

    const camIdx = config?.cameraIps ? config.cameraIps.indexOf(camIp) : -1;
    if (camIdx >= 0) {
      const legacy = cameras.find(c => c.name === `camera_${camIdx}`);
      if (legacy) return legacy;
    }
    return null;
  }

  log(message, type = 'info') {
    const time = new Date().toLocaleTimeString();
    this.logs.push({ time, message, type });
    if (this.logs.length > 100) this.logs.shift();
    console.log(`[${time}] ${message}`);
  }

  async getConfig() {
    try {
      const cfgPath = getConfigFile();
      let data;
      try {
        data = await fs.readFile(cfgPath, 'utf-8');
      } catch (readErr) {
        // Fallback: If configured path doesn't exist, search candidate locations
        const candidates = [
          path.join(process.cwd(), 'prusa-lapse.config.json'),
          path.join(process.cwd(), '..', 'prusa-lapse.config.json'),
          'C:\\Program Files\\PrusaLapse\\resources\\app\\app\\prusa-lapse.config.json',
          'C:\\Program Files\\PrusaLapse\\resources\\app\\prusa-lapse.config.json'
        ];
        let foundCandidate = null;
        for (const cand of candidates) {
          if (cand !== cfgPath && existsSync(cand)) {
            try {
              data = await fs.readFile(cand, 'utf-8');
              foundCandidate = cand;
              break;
            } catch {}
          }
        }
        if (data) {
          // Auto-seed the target configuration file so subsequent operations write to the desired path
          try {
            await fs.mkdir(path.dirname(cfgPath), { recursive: true });
            await fs.writeFile(cfgPath, data, 'utf-8');
          } catch {}
        } else {
          throw readErr;
        }
      }
      const parsed = JSON.parse(data) || {};
      return {
        ...parsed,
        slicer: {
          ...DEFAULT_SLICER_CONFIG,
          ...(parsed.slicer || {})
        }
      };
    } catch (e) {
      return {
        slicer: {
          ...DEFAULT_SLICER_CONFIG
        }
      };
    }
  }

  async syncJobMetadata(sessionDir, expectedJobId = null, fallbackJobName = null, sessionTimestamp = null) {
    try {
      if (!sessionDir) return null;
      const metaPath = path.join(sessionDir, 'meta.json');
      const thumbPath = path.join(sessionDir, 'thumbnail.png');

      const sessionBase = path.basename(sessionDir);
      if (!expectedJobId && this.fetchStatus?.isFetching && this.fetchStatus.sessionId === sessionBase) {
        expectedJobId = this.fetchStatus.jobId || null;
      }
      if (!fallbackJobName && this.fetchStatus?.isFetching && this.fetchStatus.sessionId === sessionBase) {
        fallbackJobName = this.fetchStatus.jobName || null;
      }

      let existingMeta = null;
      if (existsSync(metaPath)) {
        try {
          existingMeta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
          if (existingMeta && existingMeta.modelName && existsSync(thumbPath)) {
            const nameMatches = !fallbackJobName || existingMeta.displayName === fallbackJobName || existingMeta.modelName === fallbackJobName;
            const idMatches = !expectedJobId || existingMeta.jobId === expectedJobId;
            if (nameMatches && idMatches) {
              return existingMeta;
            }
          }
        } catch (e) {}
      }

      const config = await this.getConfig();
      const headers = {};
      if (config && config.prusaApiKey) headers['X-Api-Key'] = config.prusaApiKey;

      let displayName = fallbackJobName || existingMeta?.displayName || '';
      let thumbRef = null;
      let resolvedJobId = expectedJobId || existingMeta?.jobId || null;

      // 1. Try active /api/v1/job first
      if (config && config.prusaIp) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 3000);
          const res = await fetch(`http://${config.prusaIp}/api/v1/job`, {
            headers,
            signal: controller.signal
          });
          clearTimeout(timeout);

          if (res.ok && res.status !== 204) {
            const jobData = await res.json();
            if (jobData && jobData.file) {
              if (!expectedJobId || !jobData.id || jobData.id === expectedJobId) {
                displayName = jobData.file.display_name || jobData.file.name || displayName;
                thumbRef = jobData.file.refs?.thumbnail || jobData.file.refs?.icon || null;
                resolvedJobId = jobData.id || resolvedJobId;
              }
            }
          }
        } catch (e) {}
      }

      // 2. Fallback to /api/v1/files/usb if print already finished (/api/v1/job returned 204)
      if (config && config.prusaIp && (!displayName || !thumbRef)) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 3500);
          const filesRes = await fetch(`http://${config.prusaIp}/api/v1/files/usb`, {
            headers,
            signal: controller.signal
          });
          clearTimeout(timeout);

          if (filesRes.ok) {
            const usbData = await filesRes.json();
            const printFiles = (usbData.children || []).filter(c => c.type === 'PRINT_FILE');
            let matchedFile = null;

            if (displayName) {
              const cleanTarget = displayName.toLowerCase();
              matchedFile = printFiles.find(f =>
                (f.display_name && f.display_name.toLowerCase() === cleanTarget) ||
                (f.name && f.name.toLowerCase() === cleanTarget)
              );
            }

            // Only attempt timestamp heuristic if we DO NOT already have a displayName or expectedJobId
            if (!matchedFile && !displayName && !expectedJobId && printFiles.length > 0) {
              let sessionEpochSec = 0;
              if (sessionTimestamp && sessionTimestamp.length >= 15) {
                const y = parseInt(sessionTimestamp.substring(0, 4), 10);
                const m = parseInt(sessionTimestamp.substring(4, 6), 10) - 1;
                const d = parseInt(sessionTimestamp.substring(6, 8), 10);
                const hr = parseInt(sessionTimestamp.substring(9, 11), 10);
                const mn = parseInt(sessionTimestamp.substring(11, 13), 10);
                const sc = parseInt(sessionTimestamp.substring(13, 15), 10);
                sessionEpochSec = Math.floor(Date.UTC(y, m, d, hr, mn, sc) / 1000);
              }

              const sorted = [...printFiles].sort((a, b) => (b.m_timestamp || 0) - (a.m_timestamp || 0));
              if (sessionEpochSec > 0) {
                // Must be within 6 hours of session start
                matchedFile = sorted.find(f => Math.abs((f.m_timestamp || 0) - sessionEpochSec) <= 21600);
              }
            }

            if (matchedFile) {
              if (!displayName) {
                displayName = matchedFile.display_name || matchedFile.name || '';
              }
              if (!thumbRef) {
                thumbRef = matchedFile.refs?.thumbnail || matchedFile.refs?.icon || null;
              }
            }
          }
        } catch (e) {}
      }

      if (!displayName && !existingMeta?.modelName) return null;

      const parsed = parsePrusaFilename(displayName) || { displayName, modelName: existingMeta?.modelName || displayName };
      if (existingMeta?.customName) {
        parsed.modelName = existingMeta.customName;
      }

      const isMismatchedThumb = existingMeta?.modelName && parsed.modelName && existingMeta.modelName !== parsed.modelName;
      let hasThumbnail = existsSync(thumbPath) && !isMismatchedThumb;
      if (thumbRef && (!hasThumbnail || isMismatchedThumb) && config && config.prusaIp) {
        try {
          const thumbCtrl = new AbortController();
          const thumbTimeout = setTimeout(() => thumbCtrl.abort(), 5000);
          const thumbRes = await fetch(`http://${config.prusaIp}${thumbRef}`, {
            headers,
            signal: thumbCtrl.signal
          });
          clearTimeout(thumbTimeout);
          if (thumbRes.ok) {
            const arr = await thumbRes.arrayBuffer();
            const buf = Buffer.from(arr);
            if (buf.length > 100) {
              await fs.mkdir(sessionDir, { recursive: true });
              await fs.writeFile(thumbPath, buf);
              hasThumbnail = true;
              this.log(`Downloaded print thumbnail (${Math.round(buf.length / 1024)} KB) for "${parsed.modelName}"`, 'success');
            }
          }
        } catch (e) {}
      }

      const meta = {
        ...existingMeta,
        jobId: resolvedJobId,
        ...parsed,
        hasThumbnail,
        syncedAt: new Date().toISOString()
      };

      await fs.mkdir(sessionDir, { recursive: true });
      await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
      return meta;
    } catch (e) {
      return null;
    }
  }

  async renameSession(sessionId, newName) {
    if (!sessionId || typeof sessionId !== 'string' || !sessionId.startsWith('session_') || sessionId.includes('..')) {
      throw new Error('Invalid session ID');
    }
    const cleanName = (newName || '').trim();
    if (!cleanName) throw new Error('Session name cannot be empty');

    const sessionDir = path.join(CAPTURES_DIR, sessionId);
    const metaPath = path.join(sessionDir, 'meta.json');
    let existing = {};
    if (existsSync(metaPath)) {
      try {
        existing = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
      } catch (e) {}
    }
    const updated = {
      ...existing,
      modelName: cleanName,
      customName: cleanName,
      updatedAt: new Date().toISOString()
    };
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(metaPath, JSON.stringify(updated, null, 2), 'utf-8');
    this.log(`Renamed session ${sessionId} to "${cleanName}"`, 'info');
    return updated;
  }

  async downloadCameraFrame(ip, cameraIndex) {
    if (!this.currentSession) return;

    try {
      let dlRes = null;
      let retries = 35; // 35 * 200ms = 7 seconds timeout (allows for slow resolution switching)
      let dlController = null;
      
      while (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, 200));
        dlController = new AbortController();
        const dlTimeout = setTimeout(() => dlController.abort(), 10000); // Increased connection/header timeout to 10 seconds
        
        try {
          dlRes = await fetch(`http://${ip}/saved-photo.jpg`, { signal: dlController.signal });
          clearTimeout(dlTimeout);
          
          if (dlRes.status !== 503) {
            break; // 200 OK or 404 Error, either way we are done polling
          }
        } catch (e) {
          clearTimeout(dlTimeout);
          // If connection refused/timeout, just keep polling
        }
        retries--;
      }
      
      if (dlRes && dlRes.ok) {
        // Enforce a generous timeout on the body download (45 seconds) to prevent infinite hangs while accommodating Wi-Fi congestion
        const bodyTimeout = setTimeout(() => {
          if (dlController) dlController.abort();
        }, 45000);

        try {
          const arrayBuffer = await dlRes.arrayBuffer();
          clearTimeout(bodyTimeout);
          
          const buffer = Buffer.from(arrayBuffer);
          
          // Ensure path exists using hardware MAC folder name (with IP fallback)
          const config = await this.getConfig();
          const folderName = await this.resolveCameraFolderKey(ip, config);
          const dirPath = path.join(CAPTURES_DIR, this.currentSession, folderName);
          await fs.mkdir(dirPath, { recursive: true });
          
          if (!this.localFrameCounts) {
            this.localFrameCounts = {};
          }
          const currentCount = this.localFrameCounts[folderName] || 0;
          
          // Save image file
          const filename = `frame_${String(currentCount).padStart(4, '0')}.jpg`;
          const filePath = path.join(dirPath, filename);
          await fs.writeFile(filePath, buffer);
          
          this.localFrameCounts[folderName] = currentCount + 1;
          
          this.log(`Camera ${cameraIndex} (${ip} -> ${folderName}) downloaded frame ${currentCount} successfully`, 'success');
        } catch (err) {
          clearTimeout(bodyTimeout);
          throw err; // rethrow to be caught by outer try-catch
        }
      } else {
        const statusMsg = dlRes ? `Status ${dlRes.status}` : 'Connection failed or timeout';
        this.log(`Camera ${cameraIndex} (${ip}) download failed: ${statusMsg}`, 'error');
      }
    } catch (error) {
      this.log(`Camera ${cameraIndex} (${ip}) unreachable during download: ${error.message}`, 'error');
    }
  }

  async pollCameras(config) {
    if (!this.isRunning) return;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      let anyNewFrames = false;

      for (let i = 0; i < config.cameraIps.length; i++) {
        const ip = config.cameraIps[i];
        try {
          const res = await fetch(`http://${ip}/camera_status`, { signal: controller.signal });
          if (res.ok) {
            const data = await res.json();
            this.recordCameraIdentity(ip, data).catch(() => {});
            const currentFrameCount = data.frame_count || 0;
            let lastKnown = this.remoteFrameCounts[ip] || 0;
            if (currentFrameCount < lastKnown) {
              // Camera started a new session or rebooted and reset its counter
              lastKnown = 0;
              this.remoteFrameCounts[ip] = 0;
            }

            if (currentFrameCount > lastKnown) {
              this.log(`Camera ${i} (${ip}) has a new frame! (Local: ${lastKnown}, Remote: ${currentFrameCount})`, 'info');
              // Download the new frame from the RAM buffer WITHOUT triggering another capture!
              await this.downloadCameraFrame(ip, i);
              this.remoteFrameCounts[ip] = currentFrameCount;
              anyNewFrames = true;
            }
          }
        } catch (err) {
          if (err.name !== 'AbortError') {
            // Silently ignore unreachable cameras to avoid spamming the log,
            // they might be rebooting or offline
          }
        }
      }
      clearTimeout(timeoutId);

      if (anyNewFrames) {
        this.frameCount++;
        if (this.currentSession) {
          await this.syncJobMetadata(path.join(CAPTURES_DIR, this.currentSession));
        }
      }

    } catch (error) {
      // Ignore global polling errors
    }

    if (this.isRunning) {
      this.intervalId = setTimeout(() => this.pollCameras(config), 2000); // Check every 2 seconds
    }
  }

  async manualTrigger() {
    const config = await this.getConfig();
    if (!config || !config.cameraIps || config.cameraIps.length === 0) {
      this.log('Cannot capture: No cameras configured.', 'error');
      return { success: false, error: 'No cameras configured' };
    }
    
    this.log(`Manual trigger: Sending capture command...`, 'info');
    let hasError = false;
    let errors = [];

    const promises = config.cameraIps.map(async (ip, idx) => {
      try {
        const captureController = new AbortController();
        const captureTimeout = setTimeout(() => captureController.abort(), 6000);
        const captureRes = await fetch(`http://${ip}/action_capture`, { signal: captureController.signal });
        clearTimeout(captureTimeout);

        if (!captureRes.ok) {
          this.log(`Camera ${idx} (${ip}) capture failed: Status ${captureRes.status}`, 'error');
          hasError = true;
          errors.push(`Camera ${idx} returned status ${captureRes.status}`);
        } else {
          this.log(`Camera ${idx} (${ip}) capture triggered. Photo will be downloaded by poller.`, 'info');
        }
      } catch (error) {
        this.log(`Camera ${idx} (${ip}) unreachable: ${error.message}`, 'error');
        hasError = true;
        errors.push(`Camera ${idx} unreachable`);
      }
    });
    
    await Promise.all(promises);
    if (hasError) {
      return { success: false, error: errors.join('. ') };
    }
    return { success: true, frameCount: this.frameCount };
  }

  async start() {
    if (this.isRunning) return;
    
    const config = await this.getConfig();
    if (!config || !config.cameraIps || config.cameraIps.length === 0) {
      this.log('Cannot start PC Backup: No cameras configured.', 'error');
      return;
    }

    const now = new Date();
    this.currentSession = 'session_' + generateSessionTimestamp(now);

    this.isRunning = true;
    this.frameCount = 0;
    this.remoteFrameCounts = {}; // Track remote frame counts per IP
    this.localFrameCounts = {}; // Track local downloaded frames per camera index
    
    // Initialize current frame counts from cameras so we don't download old ones immediately
    for (const ip of config.cameraIps) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`http://${ip}/camera_status`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
          const data = await res.json();
          this.remoteFrameCounts[ip] = data.frame_count || 0;
        } else {
          this.remoteFrameCounts[ip] = 0;
        }
      } catch (err) {
        this.remoteFrameCounts[ip] = 0;
      }
    }
    
    this.log(`Started PC Backup Sync. Monitoring cameras for new frames...`, 'success');
    this.log(`Session directory: ${this.currentSession}`, 'info');

    const sessionDir = path.join(CAPTURES_DIR, this.currentSession);
    await fs.mkdir(sessionDir, { recursive: true });
    await this.syncJobMetadata(sessionDir);

    this.intervalId = setTimeout(() => this.pollCameras(config), 2000);
  }

  stop() {
    if (!this.isRunning) return;
    clearTimeout(this.intervalId);
    this.isRunning = false;
    this.log(`PC Backup Sync stopped. Synced ${this.frameCount} frames to local PC.`, 'info');
  }

  async isTimelapseRecording() {
    // 1. Live PC Monitoring is active
    if (this.isRunning) {
      return {
        isRecording: true,
        reason: 'Live PC Sync monitoring is actively capturing frames'
      };
    }

    // 2. Simulated/fake print is active
    if (this.fakePrintActive) {
      return {
        isRecording: true,
        reason: 'A test print session is actively recording'
      };
    }

    // 3. Check recently recorded camera printer states (within last 30 seconds)
    const now = Date.now();
    for (const [ip, info] of Object.entries(this.knownCameraPrinterStates || {})) {
      if (now - (info.updatedAt || 0) < 30000) {
        if (info.state === 'PRINTING' || info.state === 'PAUSED') {
          return {
            isRecording: true,
            reason: `Camera (${ip}) is actively recording a print (${info.jobName || 'Print in progress'})`,
            jobName: info.jobName,
            jobId: info.jobId
          };
        }
      }
    }

    // 4. Quick check on configured cameras (short 1200ms timeout)
    try {
      const config = await this.getConfig();
      if (config && config.cameraIps && config.cameraIps.length > 0) {
        const checks = await Promise.allSettled(
          config.cameraIps.map(async (ip) => {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 1200);
            const res = await fetch(`http://${ip}/camera_status`, { signal: ctrl.signal });
            clearTimeout(t);
            if (res.ok) {
              const data = await res.json();
              this.recordCameraIdentity(ip, data).catch(() => {});
              const st = (data.printer_state || '').toUpperCase();
              if (st === 'PRINTING' || st === 'PAUSED') {
                return { isPrinting: true, ip, jobName: data.job_name, jobId: data.job_id };
              }
            }
            return { isPrinting: false };
          })
        );

        for (const c of checks) {
          if (c.status === 'fulfilled' && c.value && c.value.isPrinting) {
            return {
              isRecording: true,
              reason: `Camera (${c.value.ip}) is actively recording a print (${c.value.jobName || 'Print in progress'})`,
              jobName: c.value.jobName,
              jobId: c.value.jobId
            };
          }
        }
      }
    } catch (e) {
      // Ignore network errors during fast check
    }

    return { isRecording: false, reason: null };
  }

  async fetchOfflineSession(targetSessionIds = null, sessionTimestamp = null, jobName = null, jobId = null, remoteSessionId = null, remoteFrameCounts = null) {
    if (this.isCompiling) {
      this.log('Cannot fetch offline session while compiling.', 'error');
      throw new Error('Monitor is busy compiling');
    }

    const recordingCheck = await this.isTimelapseRecording();
    if (recordingCheck.isRecording) {
      this.log(`Sync request rejected: Cannot sync while timelapse is actively recording (${recordingCheck.reason}).`, 'warning');
      throw new Error(`Sync actions are disabled while a timelapse is actively recording (${recordingCheck.reason}).`);
    }

    if (this.fetchStatus && this.fetchStatus.isFetching) {
      this.log(`Sync request rejected: Another session (${this.fetchStatus.remoteSessionId || this.fetchStatus.sessionId}) is currently syncing.`, 'warning');
      throw new Error('Another session sync is already in progress. Please wait for it to complete.');
    }
    
    const config = await this.getConfig();
    if (!config || !config.cameraIps || config.cameraIps.length === 0) {
      this.log('Cannot fetch: No cameras configured.', 'error');
      throw new Error('No cameras configured');
    }

    let timestamp;
    if (sessionTimestamp) {
      timestamp = sessionTimestamp;
    } else {
      timestamp = generateSessionTimestamp();
    }
    
    const sessionId = `session_${timestamp}`;
    const sessionDir = path.join(CAPTURES_DIR, sessionId);

    const initialExpected = remoteFrameCounts
      ? Object.values(remoteFrameCounts).reduce((sum, n) => sum + (Number(n) || 0), 0)
      : 0;

    // Initialize fetchStatus immediately before any async I/O or printer network calls
    // so client polling sees active sync status from the very first millisecond.
    this.fetchStatus = {
      isFetching: true,
      sessionId,
      remoteSessionId,
      sessionTimestamp: timestamp,
      jobName,
      jobId,
      targetSessionIds,
      remoteFrameCounts,
      overallProgress: 0,
      progress: 0,
      totalFramesExpected: initialExpected,
      totalFramesFetched: 0,
      currentCameraIndex: 0,
      totalCameras: config.cameraIps.length,
      cameras: config.cameraIps.map((ip, idx) => {
        const exp = remoteFrameCounts && typeof remoteFrameCounts[ip] === 'number' ? remoteFrameCounts[ip] : 0;
        const skip = Boolean(targetSessionIds && !targetSessionIds[ip]);
        const folderName = this.getCameraFolderKeySync(ip, config);
        const mac = normalizeMacHex(config?.cameraMacs?.[ip]);
        return {
          index: idx,
          ip,
          mac,
          folderName,
          cameraName: (mac && config?.cameraNames?.[mac]) || config?.cameraNames?.[ip] || null,
          expected: exp,
          fetched: 0,
          status: skip ? 'skipped' : 'syncing'
        };
      })
    };

    try {
      await fs.mkdir(sessionDir, { recursive: true });

      // Write initial local meta.json immediately (zero network wait) so session polling never sees an uninitialized directory
      if (jobName || jobId || targetSessionIds || remoteFrameCounts) {
        try {
          const metaPath = path.join(sessionDir, 'meta.json');
          let existingMeta = {};
          if (existsSync(metaPath)) {
            try {
              existingMeta = JSON.parse(await fs.readFile(metaPath, 'utf-8')) || {};
            } catch {}
          }
          const parsed = jobName ? (parsePrusaFilename(jobName) || { displayName: jobName, modelName: jobName }) : {};
          if (existingMeta.customName) {
            parsed.modelName = existingMeta.customName;
          }
          const cameraFolders = { ...(existingMeta.cameraFolders || {}) };
          for (const ip of config.cameraIps) {
            cameraFolders[ip] = this.getCameraFolderKeySync(ip, config);
          }
          const initialMeta = {
            ...existingMeta,
            ...(jobId ? { jobId } : {}),
            ...parsed,
            cameraFolders,
            ...(targetSessionIds ? { remoteSessionIds: { ...(existingMeta.remoteSessionIds || {}), ...targetSessionIds } } : {}),
            ...(remoteFrameCounts ? { remoteFrameCounts: { ...(existingMeta.remoteFrameCounts || {}), ...remoteFrameCounts } } : {}),
            hasThumbnail: Boolean(existingMeta.hasThumbnail || existsSync(path.join(sessionDir, 'thumbnail.png'))),
            syncedAt: existingMeta.syncedAt || new Date().toISOString()
          };
          await fs.writeFile(metaPath, JSON.stringify(initialMeta, null, 2), 'utf-8');
        } catch {}
      }

      // Fetch thumbnail/printer metadata in the background so slow/offline printer HTTP timeouts never block SD frame downloads
      const metadataSyncPromise = (jobName || jobId)
        ? this.syncJobMetadata(sessionDir, jobId, jobName, timestamp).catch(() => {})
        : Promise.resolve();

      // Migrate any legacy session_offline_ directory into sessionDir
      const legacyOfflineDir = path.join(CAPTURES_DIR, `session_offline_${timestamp}`);
      try {
        const lStat = await fs.stat(legacyOfflineDir);
        if (lStat.isDirectory()) {
          const lEntries = await fs.readdir(legacyOfflineDir, { withFileTypes: true });
          for (const entry of lEntries) {
            if (entry.isDirectory() && entry.name.startsWith('camera_')) {
              const targetCamDir = path.join(sessionDir, entry.name);
              await fs.mkdir(targetCamDir, { recursive: true });
              const files = await fs.readdir(path.join(legacyOfflineDir, entry.name));
              for (const f of files) {
                try {
                  await fs.copyFile(path.join(legacyOfflineDir, entry.name, f), path.join(targetCamDir, f));
                } catch {}
              }
            }
          }
          await fs.rm(legacyOfflineDir, { recursive: true, force: true });
        }
      } catch {}
      
      this.log(`Started fetching session: ${sessionId}`, 'info');

      let hasError = false;
      let errors = [];

      // Step 1: Resolve target frames per camera without overwhelming ESP32 with full SD file listings
      const sessionInfo = await Promise.all(
        config.cameraIps.map(async (ip, i) => {
          const folderName = await this.resolveCameraFolderKey(ip, config);
          const targetSessionId = targetSessionIds ? targetSessionIds[ip] : null;
          if (targetSessionIds && !targetSessionId) {
            this.log(`Camera ${i} (${ip}) has no remote session ID for timestamp ${timestamp}. Skipping.`, 'info');
            return { ip, index: i, folderName, skip: true, files: [], targetFiles: [] };
          }

          const expFrames = remoteFrameCounts ? remoteFrameCounts[ip] : null;
          if (targetSessionId && typeof expFrames === 'number' && expFrames > 0) {
            // Direct deterministic file generation from sessions.jsonl - NO /list_sd required!
            const targetFiles = Array.from({ length: expFrames }, (_, idx) => `${targetSessionId}_f${String(idx).padStart(4, '0')}.jpg`);
            return {
              ip,
              index: i,
              folderName,
              effectiveSessionId: targetSessionId,
              files: targetFiles,
              targetFiles,
              hasTar: false
            };
          }

          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 6000);
            const listUrl = targetSessionId ? `http://${ip}/list_sd?session=${targetSessionId}` : `http://${ip}/list_sd`;
            const listRes = await fetch(listUrl, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (!listRes.ok) {
              this.log(`Camera ${i} (${ip}) failed to list files: ${listRes.status}`, 'error');
              return { ip, index: i, folderName, error: `HTTP ${listRes.status}`, files: [], targetFiles: [] };
            }

            const files = await listRes.json();
            if (!files || files.length === 0) {
              this.log(`Camera ${i} (${ip}) has no files on SD card.`, 'info');
              return { ip, index: i, folderName, empty: true, files: [], targetFiles: [] };
            }

            let effectiveSessionId = targetSessionId;
            if (!effectiveSessionId) {
              const prefixes = new Set();
              for (const f of files) {
                const base = f.split('/').pop();
                const m = base.match(/^(s\d{4})_/);
                if (m) prefixes.add(m[1]);
              }
              if (prefixes.size > 0) {
                const sortedPrefixes = Array.from(prefixes).sort();
                effectiveSessionId = sortedPrefixes[sortedPrefixes.length - 1];
              }
            }

            const targetFiles = files.filter(f => {
              const file = f.split('/').pop();
              if (file === 'sessions.jsonl' || file === 'config.txt' || file.endsWith('.tar') || file.endsWith('.tmp')) return false;
              if (effectiveSessionId && !file.startsWith(effectiveSessionId + '_')) return false;
              return file.endsWith('.jpg');
            });

            return {
              ip,
              index: i,
              folderName,
              effectiveSessionId,
              files,
              targetFiles,
              hasTar: false
            };
          } catch (err) {
            this.log(`Camera ${i} (${ip}) discovery failed: ${err.message}`, 'error');
            return { ip, index: i, folderName, error: err.message, files: [], targetFiles: [] };
          }
        })
      );

      // Step 2: Calculate total expected frames across all cameras
      const totalFramesExpected = sessionInfo.reduce((sum, cam) => sum + (cam.targetFiles ? cam.targetFiles.length : 0), 0);

      // Step 3: Update global monotonic progress tracker with resolved camera file lists
      this.fetchStatus = {
        ...this.fetchStatus,
        isFetching: true,
        totalFramesExpected,
        cameras: sessionInfo.map(cam => {
          const mac = normalizeMacHex(this.knownCameraMacs?.[cam.ip]) || normalizeMacHex(config?.cameraMacs?.[cam.ip]);
          return {
            index: cam.index,
            ip: cam.ip,
            mac,
            folderName: cam.folderName,
            cameraName: (mac && (this.knownCameraNames?.[mac] || config?.cameraNames?.[mac])) || this.knownCameraNames?.[cam.ip] || config?.cameraNames?.[cam.ip] || null,
            expected: cam.targetFiles ? cam.targetFiles.length : 0,
            fetched: 0,
            status: cam.error ? 'error' : (cam.skip ? 'skipped' : 'syncing')
          };
        })
      };

      const recordFrameDownloaded = (camIndex) => {
        if (this.fetchStatus) {
          if (this.fetchStatus.cameras && this.fetchStatus.cameras[camIndex]) {
            this.fetchStatus.cameras[camIndex].fetched++;
          }
          this.fetchStatus.totalFramesFetched++;
          if (this.fetchStatus.totalFramesExpected > 0) {
            const pct = Math.min(
              100,
              Math.round((this.fetchStatus.totalFramesFetched / this.fetchStatus.totalFramesExpected) * 100)
            );
            this.fetchStatus.overallProgress = pct;
            this.fetchStatus.progress = pct;
          }
        }
      };

      // Pre-scan already downloaded frames across all cameras so resume progress is accurate immediately
      for (const camInfo of sessionInfo) {
        if (camInfo.skip || camInfo.error || !camInfo.targetFiles || camInfo.targetFiles.length === 0) {
          camInfo.remainingFiles = [];
          continue;
        }
        const { index, folderName, targetFiles } = camInfo;
        const camDir = path.join(sessionDir, folderName);
        await fs.mkdir(camDir, { recursive: true });
        const remainingFiles = [];
        for (const fileStr of targetFiles) {
          const file = fileStr.split('/').pop();
          let saveFilename = file;
          if (file.startsWith('s') && file.includes('_f')) {
            const parts = file.split('_f');
            if (parts.length === 2) {
              const frameIndexStr = parts[1].replace('.jpg', '');
              saveFilename = `frame_${frameIndexStr.padStart(4, '0')}.jpg`;
            }
          }
          const localPath = path.join(camDir, saveFilename);
          let alreadyOnDisk = false;
          try {
            const s = await fs.stat(localPath);
            if (s.size > 500) {
              alreadyOnDisk = true;
              recordFrameDownloaded(index);
            }
          } catch {}
          if (!alreadyOnDisk) {
            remainingFiles.push({ remoteFile: file, saveFilename, localPath });
          }
        }
        camInfo.remainingFiles = remainingFiles;
      }

      // Step 4: Download frames per camera
      const downloadCameraFiles = async (camInfo) => {
        if (camInfo.skip || camInfo.error || !camInfo.targetFiles || camInfo.targetFiles.length === 0) {
          if (camInfo.error) {
            hasError = true;
            errors.push(`Camera ${camInfo.index} (${camInfo.ip}): ${camInfo.error}`);
          }
          return;
        }

        const { ip, index, remainingFiles = [] } = camInfo;

        if (remainingFiles.length > 0) {
          this.log(`Camera ${index} (${ip}) downloading ${remainingFiles.length} frames via HTTP Keep-Alive...`, 'info');
          let cursor = 0;
          let consecutiveFailures = 0;

          while (cursor < remainingFiles.length) {
            if (consecutiveFailures >= 4) {
              this.log(`Camera ${index} (${ip}) disconnected (4 consecutive timeouts). Skipping remaining ${remainingFiles.length - cursor} frames.`, 'warning');
              hasError = true;
              errors.push(`Camera ${index} (${ip}) disconnected`);
              if (this.fetchStatus && this.fetchStatus.cameras[index]) {
                this.fetchStatus.cameras[index].status = 'error';
              }
              break;
            }

            const item = remainingFiles[cursor++];
            let downloaded = false;

            for (let attempt = 0; attempt < 3; attempt++) {
              let timeoutId = null;
              try {
                const controller = new AbortController();
                // Generous 35s timeout to safely accommodate ~100KB frames over congested Wi-Fi
                timeoutId = setTimeout(() => controller.abort(), 35000);
                const dlRes = await fetch(`http://${ip}/download_sd?file=${item.remoteFile}`, {
                  signal: controller.signal
                });

                if (dlRes.ok) {
                  const arrayBuffer = await dlRes.arrayBuffer();
                  clearTimeout(timeoutId);
                  timeoutId = null;
                  const buffer = Buffer.from(arrayBuffer);
                  if (buffer.length > 500) {
                    await fs.writeFile(item.localPath, buffer);
                    recordFrameDownloaded(index);
                    downloaded = true;
                    consecutiveFailures = 0;
                    break;
                  }
                } else {
                  clearTimeout(timeoutId);
                  timeoutId = null;
                }
              } catch (e) {
                if (timeoutId) {
                  clearTimeout(timeoutId);
                  timeoutId = null;
                }
                if (attempt < 2) {
                  await new Promise(r => setTimeout(r, 1000));
                }
              }
            }

            if (!downloaded) {
              consecutiveFailures++;
              this.log(`Camera ${index} (${ip}) failed to download ${item.remoteFile} (${consecutiveFailures}/4)`, 'error');
              hasError = true;
              errors.push(`Camera ${index} failed ${item.remoteFile}`);
            }
          }
        }

        if (this.fetchStatus && this.fetchStatus.cameras[index]) {
          if (this.fetchStatus.cameras[index].status !== 'error') {
            this.fetchStatus.cameras[index].status = 'done';
          }
        }
        this.log(`Camera ${index} (${ip}) sync complete.`, 'success');
      };

      // Step 5: Execute cameras sequentially to prevent shared 5V power bus sags and Wi-Fi brownouts
      for (const cam of sessionInfo) {
        await downloadCameraFiles(cam);
      }

      // Step 6: Count actual frames verified on disk across all camera_* folders
      let totalFramesFetched = 0;
      try {
        const dirItems = await fs.readdir(sessionDir, { withFileTypes: true });
        for (const dItem of dirItems) {
          if (dItem.isDirectory() && dItem.name.startsWith('camera_')) {
            try {
              const files = await fs.readdir(path.join(sessionDir, dItem.name));
              totalFramesFetched += files.filter(f => f.startsWith('frame_') && f.endsWith('.jpg')).length;
            } catch {}
          }
        }
      } catch {}

      if (totalFramesFetched === 0) {
        this.log('Offline fetch aborted. No files were downloaded.', 'warning');
        return { success: false, error: 'No files downloaded. ' + errors.join('. ') };
      }

      if (this.fetchStatus) {
        this.fetchStatus.overallProgress = 100;
        this.fetchStatus.progress = 100;
        this.fetchStatus.totalFramesFetched = totalFramesFetched;
      }

      await metadataSyncPromise;
      try {
        await this.syncJobMetadata(sessionDir, jobId, jobName, timestamp);
      } catch {}
      this.remoteSessionsCache = this.remoteSessionsCache.filter(s => s.timestamp !== timestamp);
      this.lastFetchResult = {
        success: true,
        sessionId,
        totalFramesFetched,
        completedAt: Date.now()
      };
      this.log(`Session sync completed successfully (${totalFramesFetched} frames). Saved as ${sessionId}.`, 'success');
      return { success: true, sessionId };
    } catch (fetchErr) {
      this.lastFetchResult = {
        success: false,
        sessionId,
        error: fetchErr.message,
        completedAt: Date.now()
      };
      throw fetchErr;
    } finally {
      this.fetchStatus = null;
    }
  }

  async wipeOfflineSD() {
    const recordingCheck = await this.isTimelapseRecording();
    if (recordingCheck.isRecording) {
      this.log(`Wipe SD rejected: Cannot wipe while timelapse is actively recording (${recordingCheck.reason}).`, 'warning');
      return { success: false, error: `Cannot wipe camera SD cards while a timelapse is actively recording (${recordingCheck.reason}).` };
    }

    const config = await this.getConfig();
    if (!config || !config.cameraIps || config.cameraIps.length === 0) {
      this.log('Cannot wipe: No cameras configured.', 'error');
      throw new Error('No cameras configured');
    }
    
    this.log('Wiping SD cards on all cameras...', 'warning');
    this.remoteSessionsCache = [];
    this.fetchStatus = null;
    try {
      await fs.unlink(path.join(CAPTURES_DIR, 'remote_sessions_cache.json'));
    } catch (e) {}
    let hasError = false;
    let errors = [];
    
    for (let i = 0; i < config.cameraIps.length; i++) {
      const ip = config.cameraIps[i];
      try {
        const wipeRes = await fetch(`http://${ip}/wipe_sd`);
        if (wipeRes.ok) {
           this.log(`Camera ${i} (${ip}) SD card wiped successfully.`, 'success');
        } else {
           this.log(`Camera ${i} (${ip}) failed to wipe SD card: ${wipeRes.status}`, 'error');
           hasError = true;
           errors.push(`Camera ${i} returned status ${wipeRes.status}`);
        }
      } catch (err) {
        this.log(`Camera ${i} (${ip}) unreachable for SD wipe: ${err.message}`, 'error');
        hasError = true;
        errors.push(`Camera ${i} unreachable`);
      }
    }
    
    if (hasError) {
      return { success: false, error: errors.join('. ') };
    }
    return { success: true };
  }

  getStatus() {
    const now = Date.now();
    let cameraRecording = false;
    let recordingJobName = null;
    let recordingJobId = null;
    for (const [ip, info] of Object.entries(this.knownCameraPrinterStates || {})) {
      if (now - (info.updatedAt || 0) < 30000 && (info.state === 'PRINTING' || info.state === 'PAUSED')) {
        cameraRecording = true;
        recordingJobName = info.jobName;
        recordingJobId = info.jobId;
        break;
      }
    }
    const isRecording = this.isRunning || this.fakePrintActive || cameraRecording;

    return {
      isRunning: this.isRunning,
      isRecording,
      recordingJobName,
      recordingJobId,
      currentSession: this.currentSession,
      frameCount: this.frameCount,
      isCompiling: this.isCompiling,
      logs: this.logs,
      fetchStatus: this.fetchStatus,
      lastFetchResult: this.lastFetchResult || null
    };
  }

  async getSessions(includeRemote = false) {
    try {
      await fs.mkdir(CAPTURES_DIR, { recursive: true });
      const scanConfig = await this.getConfig();
      const entries = await fs.readdir(CAPTURES_DIR, { withFileTypes: true });
      const sessions = [];
      
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('session_')) {
          const sessionPath = path.join(CAPTURES_DIR, entry.name);
          const cameras = [];
          const items = await fs.readdir(sessionPath, { withFileTypes: true });
          
          let videos = [];
          let hasThumbnail = false;
          let meta = null;
          for (const item of items) {
            if (item.isDirectory() && item.name.startsWith('camera_')) {
              const camPath = path.join(sessionPath, item.name);
              const files = await fs.readdir(camPath);
              const frameFiles = files.filter(f => f.startsWith('frame_') && f.endsWith('.jpg'));
              const suffix = item.name.slice('camera_'.length);
              const mac = /^[0-9A-Fa-f]{12}$/.test(suffix) ? suffix.toUpperCase() : null;
              let matchedIp = null;
              if (mac && scanConfig?.cameraMacs) {
                matchedIp = Object.entries(scanConfig.cameraMacs).find(([, m]) => normalizeMacHex(m) === mac)?.[0] || null;
              } else if (/^\d+_\d+_\d+_\d+$/.test(suffix)) {
                matchedIp = suffix.replace(/_/g, '.');
              }
              const cfgIdx = (matchedIp && scanConfig?.cameraIps) ? scanConfig.cameraIps.indexOf(matchedIp) : -1;
              const numericIdx = /^\d+$/.test(suffix) ? parseInt(suffix, 10) : -1;
              const cameraIndex = cfgIdx >= 0 ? cfgIdx : (numericIdx >= 0 ? numericIdx : 999);
              const cameraName = (mac && (this.knownCameraNames?.[mac] || scanConfig?.cameraNames?.[mac])) ||
                (matchedIp && (this.knownCameraNames?.[matchedIp] || scanConfig?.cameraNames?.[matchedIp])) ||
                null;
              cameras.push({
                name: item.name,
                mac,
                ip: matchedIp,
                cameraName,
                cameraIndex,
                frameCount: frameFiles.length,
              });
            } else if (item.isFile() && item.name.endsWith('.mp4')) {
              videos.push(item.name);
            } else if (item.isFile() && item.name === 'thumbnail.png') {
              hasThumbnail = true;
            } else if (item.isFile() && (item.name === 'meta.json' || item.name === 'metadata.json')) {
              try {
                const parsedMeta = JSON.parse(await fs.readFile(path.join(sessionPath, item.name), 'utf-8'));
                meta = { ...meta, ...parsedMeta };
              } catch (e) {}
            }
          }
          cameras.sort((a, b) => (a.cameraIndex ?? 999) - (b.cameraIndex ?? 999) || a.name.localeCompare(b.name));
          
          const isOffline = entry.name.startsWith('session_offline_');
          let timestamp = entry.name.replace('session_', '');
          if (isOffline) {
            timestamp = entry.name.replace('session_offline_', '');
          }

          if (!meta || !meta.modelName) {
            const fetchJobId = (this.fetchStatus?.sessionId === entry.name) ? this.fetchStatus.jobId : null;
            const fetchJobName = (this.fetchStatus?.sessionId === entry.name) ? this.fetchStatus.jobName : null;
            const synced = await this.syncJobMetadata(
              sessionPath,
              meta?.jobId || meta?.job_id || fetchJobId || null,
              meta?.displayName || meta?.job_name || fetchJobName || null,
              timestamp
            );
            if (synced) {
              meta = synced;
              if (synced.hasThumbnail) hasThumbnail = true;
            }
          }
          
          if (isOffline) {
            // Only skip if the session has literally 0 frames and is not currently fetching
            const hasFrames = cameras.some(c => c.frameCount > 0);
            const isCurrentlyFetchingThis = this.fetchStatus?.isFetching && this.fetchStatus?.sessionId === entry.name;
            if (!isCurrentlyFetchingThis && !hasFrames && videos.length === 0) {
              continue;
            }
          }

          sessions.push({
            id: entry.name,
            timestamp,
            isOffline,
            cameras,
            videos,
            hasThumbnail,
            meta,
            ...(meta?.remoteSessionIds ? { remoteSessionIds: meta.remoteSessionIds } : {}),
            ...(meta?.remoteFrameCounts ? { remoteFrameCounts: meta.remoteFrameCounts } : {})
          });
        }
      }
      
      // Fetch remote sessions from cameras if explicitly requested or if cache is empty
      const remoteCacheFile = path.join(CAPTURES_DIR, 'remote_sessions_cache.json');
      if (includeRemote || !this.remoteSessionsCache || this.remoteSessionsCache.length === 0) {
        const newRemoteCache = [];
        const config = await this.getConfig();
        let persistedByIp = {};
        try {
          if (existsSync(remoteCacheFile)) {
            persistedByIp = JSON.parse(await fs.readFile(remoteCacheFile, 'utf-8')) || {};
          }
        } catch (e) {
          persistedByIp = {};
        }

        if (config && config.cameraIps) {
          let cacheUpdated = false;
          const results = await Promise.all(
            config.cameraIps.map(async (ip) => {
              let jsonlText = null;
              try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 6000);
                const res = await fetch(`http://${ip}/download_sd?file=sessions.jsonl`, {
                  signal: controller.signal
                });
                clearTimeout(timeoutId);
                if (res.ok) {
                  jsonlText = await res.text();
                } else if (res.status === 404) {
                  // Camera is online, but sessions.jsonl does not exist (SD wiped or no prints recorded yet)
                  jsonlText = '';
                }
              } catch (e) {}

              if (jsonlText !== null) {
                persistedByIp[ip] = jsonlText;
                cacheUpdated = true;
                return { ip, text: jsonlText };
              }
              return { ip, text: persistedByIp[ip] || null };
            })
          );

          if (cacheUpdated) {
            try {
              await fs.writeFile(remoteCacheFile, JSON.stringify(persistedByIp, null, 2), 'utf-8');
            } catch (e) {}
          }

          let usbPrintFiles = null;
          const getUsbPrintFiles = async () => {
            if (usbPrintFiles !== null) return usbPrintFiles;
            usbPrintFiles = [];
            if (config && config.prusaIp) {
              try {
                const headers = {};
                if (config.prusaApiKey) headers['X-Api-Key'] = config.prusaApiKey;
                const ctrl = new AbortController();
                const tid = setTimeout(() => ctrl.abort(), 2500);
                const fRes = await fetch(`http://${config.prusaIp}/api/v1/files/usb`, { headers, signal: ctrl.signal });
                clearTimeout(tid);
                if (fRes.ok) {
                  const usbData = await fRes.json();
                  usbPrintFiles = (usbData.children || []).filter(c => c.type === 'PRINT_FILE');
                }
              } catch (e) {}
            }
            return usbPrintFiles;
          };

          for (const item of results) {
            const { ip, text } = item;
            if (!text) continue;
            const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
            for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
              const line = lines[lineIdx];
              if (line) {
                try {
                  const data = JSON.parse(line);
                  let timestamp = data.timestamp;
                  let targetDate = null;
                      
                      if (timestamp && timestamp.length >= 15) {
                        try {
                          const year = parseInt(timestamp.substring(0, 4), 10);
                          const month = parseInt(timestamp.substring(4, 6), 10) - 1;
                          const day = parseInt(timestamp.substring(6, 8), 10);
                          const hour = parseInt(timestamp.substring(9, 11), 10);
                          const min = parseInt(timestamp.substring(11, 13), 10);
                          const sec = parseInt(timestamp.substring(13, 15), 10);
                          targetDate = new Date(year, month, day, hour, min, sec);
                        } catch (e) {
                          targetDate = null;
                        }
                      }

                      if (!targetDate) {
                        const existingLocal = sessions.find(s => {
                          const localJobId = s.jobId || s.meta?.jobId;
                          if (data.job_id && localJobId) return data.job_id === localJobId;
                          if (data.job_id && !localJobId) return false;
                          if (data.job_name) {
                            return s.meta?.displayName === data.job_name || s.meta?.modelName === parsePrusaFilename(data.job_name)?.modelName;
                          }
                          return false;
                        });
                        if (existingLocal && existingLocal.timestamp && existingLocal.timestamp.length >= 15) {
                          timestamp = existingLocal.timestamp;
                          try {
                            const year = parseInt(timestamp.substring(0, 4), 10);
                            const month = parseInt(timestamp.substring(4, 6), 10) - 1;
                            const day = parseInt(timestamp.substring(6, 8), 10);
                            const hour = parseInt(timestamp.substring(9, 11), 10);
                            const min = parseInt(timestamp.substring(11, 13), 10);
                            const sec = parseInt(timestamp.substring(13, 15), 10);
                            targetDate = new Date(year, month, day, hour, min, sec);
                          } catch (e) {
                            targetDate = null;
                          }
                        }
                        if (!targetDate && data.job_name) {
                          const pFiles = await getUsbPrintFiles();
                          const cleanTarget = data.job_name.toLowerCase();
                          const matchedUsb = pFiles.find(f =>
                            (f.display_name && f.display_name.toLowerCase() === cleanTarget) ||
                            (f.name && f.name.toLowerCase() === cleanTarget)
                          );
                          if (matchedUsb && matchedUsb.m_timestamp) {
                            targetDate = new Date(matchedUsb.m_timestamp * 1000);
                            timestamp = generateSessionTimestamp(targetDate);
                          }
                        }
                        if (!targetDate) {
                          targetDate = new Date();
                          timestamp = generateSessionTimestamp(targetDate);
                        }
                      }
                      
                      // Merge remote sessions across DIFFERENT cameras when they represent the same print.
                      // A shared job ID alone is NOT enough: if both cameras report an explicit start time and those
                      // start times are far apart, they are different recordings (e.g. one camera rebooted or carried
                      // frames over from an unfinished session) and must never be glued into one timelapse.
                      const existingRemote = newRemoteCache.find(s => {
                        if (s.remoteSessionIds && s.remoteSessionIds[ip]) return false; // Never merge two sessions from the same camera!
                        const explicitStartsConflict = Boolean(
                          data.timestamp && s.hasExplicitTimestamp &&
                          Math.abs(s.originalDate - targetDate.getTime()) > START_TIME_TOLERANCE_MS
                        );
                        if (data.job_id && s.jobId && data.job_id === s.jobId) return !explicitStartsConflict;
                        if (data.timestamp && s.hasExplicitTimestamp && Math.abs(s.originalDate - targetDate.getTime()) < 120000) return true;
                        const existingSid = Object.values(s.remoteSessionIds || {})[0];
                        if (!data.timestamp && !s.hasExplicitTimestamp && existingSid && existingSid === data.session) return true;
                        return false;
                      });
                      const remoteMeta = data.job_name ? parsePrusaFilename(data.job_name) : null;
                      if (data.mac || data.camera_name) {
                        this.recordCameraIdentity(ip, data).catch(() => {});
                      }
                      const camFolder = this.getCameraFolderKeySync(ip, config, data.mac);
                      const camMac = normalizeMacHex(data.mac) || normalizeMacHex(this.knownCameraMacs?.[ip]) || normalizeMacHex(config?.cameraMacs?.[ip]);
                      const camName = data.camera_name || (camMac && (this.knownCameraNames?.[camMac] || config?.cameraNames?.[camMac])) || this.knownCameraNames?.[ip] || config?.cameraNames?.[ip] || null;
                      const camIdx = config?.cameraIps ? config.cameraIps.indexOf(ip) : -1;
                      const camEntry = {
                        name: camFolder,
                        mac: camMac,
                        ip,
                        cameraName: camName,
                        cameraIndex: camIdx >= 0 ? camIdx : 999,
                        frameCount: data.frames
                      };
                      
                      if (existingRemote) {
                        existingRemote.cameras.push(camEntry);
                        existingRemote.cameras.sort((a, b) => (a.cameraIndex ?? 999) - (b.cameraIndex ?? 999) || a.name.localeCompare(b.name));
                        existingRemote.remoteSessionIds[ip] = data.session;
                        if (!existingRemote.remoteFrameCounts) existingRemote.remoteFrameCounts = {};
                        existingRemote.remoteFrameCounts[ip] = data.frames;
                        if (!existingRemote.meta && remoteMeta) existingRemote.meta = remoteMeta;
                        if (timestamp < existingRemote.timestamp) {
                          existingRemote.timestamp = timestamp;
                        }
                      } else {
                        newRemoteCache.push({
                          id: `remote_${timestamp}_${data.session || lineIdx}`,
                          timestamp: timestamp,
                          hasExplicitTimestamp: Boolean(data.timestamp && data.timestamp.length >= 15),
                          originalDate: targetDate.getTime(),
                          isOffline: true,
                          isRemote: true,
                          jobId: data.job_id || null,
                          jobName: data.job_name || null,
                          meta: remoteMeta,
                          remoteSessionIds: { [ip]: data.session },
                          remoteFrameCounts: { [ip]: data.frames },
                          cameras: [camEntry],
                          videos: []
                        });
                      }
                    } catch (e) {}
                  }
                }
              }
            }
          this.remoteSessionsCache = newRemoteCache;
        }

      // Step B: Reconcile remote sessions with local sessions (runs on EVERY call, even without includeRemote)
      const unmergedRemotes = [];
      const seenRemoteKeys = new Set();
      if (this.remoteSessionsCache && this.remoteSessionsCache.length > 0) {
        const config = await this.getConfig();
        const cameraIps = config?.cameraIps || [];

        for (const remote of this.remoteSessionsCache) {
          // Key by the unique remote id (not the job ID): two recordings of the same print job that
          // are genuinely separate timelapses must each keep their own card.
          const remoteKey = remote.id || remote.timestamp;
          if (seenRemoteKeys.has(remoteKey)) continue;
          seenRemoteKeys.add(remoteKey);
          const matchingLocal = sessions.find(local => {
            if (local.isRemote) return false;
            if (local.timestamp && remote.timestamp && local.timestamp === remote.timestamp) return true;

            // The session currently being synced from this remote always belongs to it
            if (this.fetchStatus?.isFetching && this.fetchStatus.sessionId === local.id && (
              this.fetchStatus.remoteSessionId === remote.id ||
              this.fetchStatus.sessionTimestamp === remote.timestamp
            )) return true;

            // Never match on job ID when both start times are explicit and far apart: different recording
            if (remote.hasExplicitTimestamp && startTimesConflict(local.timestamp, remote.timestamp)) return false;

            if (remote.jobId && (local.jobId === remote.jobId || local.meta?.jobId === remote.jobId)) return true;

            // Never match if job IDs explicitly conflict
            const localJobId = local.jobId || local.meta?.jobId;
            if (remote.jobId && localJobId && remote.jobId !== localJobId) return false;

            // Match by active sync status
            if (this.fetchStatus?.isFetching && (
              (this.fetchStatus.remoteSessionId === remote.id && this.fetchStatus.sessionId === local.id) ||
              (this.fetchStatus.sessionTimestamp === remote.timestamp && this.fetchStatus.sessionId === local.id) ||
              (remote.jobId && this.fetchStatus.jobId === remote.jobId && this.fetchStatus.sessionId === local.id)
            )) return true;

            // Never match if timestamps explicitly conflict by > 10 minutes
            if (remote.hasExplicitTimestamp && local.timestamp) {
              try {
                const parseTs = (ts) => new Date(
                  parseInt(ts.slice(0, 4), 10), parseInt(ts.slice(4, 6), 10) - 1, parseInt(ts.slice(6, 8), 10),
                  parseInt(ts.slice(9, 11), 10), parseInt(ts.slice(11, 13), 10), parseInt(ts.slice(13, 15), 10)
                ).getTime();
                if (Math.abs(parseTs(local.timestamp) - parseTs(remote.timestamp)) > 600000) return false;
              } catch {}
            }

            // Match by remote session IDs on the same camera IP
            if (local.remoteSessionIds && remote.remoteSessionIds) {
              for (const [camIp, sid] of Object.entries(remote.remoteSessionIds)) {
                if (local.remoteSessionIds[camIp] === sid) return true;
              }
            }

            // Match by exact displayName only if timestamps/jobIds did not conflict
            const localName = local.meta?.displayName || local.jobName;
            const remoteName = remote.jobName || remote.meta?.displayName;
            if (localName && remoteName && localName === remoteName) {
              return true;
            }

            return false;
          });

          if (matchingLocal) {
            let allFramesDownloaded = true;
            for (const [camIp, expFrames] of Object.entries(remote.remoteFrameCounts || {})) {
              const lCam = this.findCameraEntryForIp(matchingLocal.cameras, camIp, config, matchingLocal.meta);
              const localCount = lCam ? lCam.frameCount : 0;
              if (localCount < expFrames) {
                allFramesDownloaded = false;
                break;
              }
            }

            matchingLocal.remoteSessionIds = { ...(matchingLocal.remoteSessionIds || {}), ...remote.remoteSessionIds };
            matchingLocal.remoteFrameCounts = { ...(matchingLocal.remoteFrameCounts || {}), ...remote.remoteFrameCounts };
            for (const [camIp, expFrames] of Object.entries(remote.remoteFrameCounts || {})) {
              const existingCam = this.findCameraEntryForIp(matchingLocal.cameras, camIp, config, matchingLocal.meta);
              if (!existingCam && Number(expFrames) > 0) {
                const camIdx = cameraIps.indexOf(camIp);
                const camMac = normalizeMacHex(this.knownCameraMacs?.[camIp]) || normalizeMacHex(config?.cameraMacs?.[camIp]);
                const camFolder = this.getCameraFolderKeySync(camIp, config);
                const camName = (camMac && (this.knownCameraNames?.[camMac] || config?.cameraNames?.[camMac])) || this.knownCameraNames?.[camIp] || config?.cameraNames?.[camIp] || null;
                matchingLocal.cameras.push({
                  name: camFolder,
                  mac: camMac,
                  ip: camIp,
                  cameraName: camName,
                  cameraIndex: camIdx >= 0 ? camIdx : 999,
                  frameCount: 0
                });
              }
            }
            matchingLocal.cameras.sort((a, b) => (a.cameraIndex ?? 999) - (b.cameraIndex ?? 999) || a.name.localeCompare(b.name));
            if (remote.jobId && (!matchingLocal.meta?.jobId || !matchingLocal.jobId)) {
              if (!matchingLocal.meta) matchingLocal.meta = {};
              matchingLocal.meta.jobId = remote.jobId;
              matchingLocal.jobId = remote.jobId;
              const metaPath = path.join(CAPTURES_DIR, matchingLocal.id, 'meta.json');
              fs.writeFile(metaPath, JSON.stringify(matchingLocal.meta, null, 2), 'utf-8').catch(() => {});
            }
            if (allFramesDownloaded) {
              matchingLocal.isSynced = true;
            } else {
              matchingLocal.isIncomplete = true;
            }
            continue; // Reconciled into local session card, don't show separate remote card!
          }

          unmergedRemotes.push(remote); // Genuine unsynced remote session
        }
      }

      // Always include unmerged remote sessions so unsynced prints on camera SD cards stay visible
      sessions.push(...unmergedRemotes);

      // Normalize sync metrics across all sessions
      const normConfig = await this.getConfig();
      const normCameraIps = normConfig?.cameraIps || [];
      for (const s of sessions) {
        if (s.isRemote) {
          s.totalFramesLocal = 0;
          let expected = 0;
          if (s.remoteFrameCounts) {
            expected = Object.values(s.remoteFrameCounts).reduce((a, b) => a + (Number(b) || 0), 0);
          } else if (s.cameras) {
            expected = s.cameras.reduce((sum, c) => sum + (c.frameCount || 0), 0);
          }
          s.totalFramesExpected = expected;
          s.syncPercentage = 0;
          s.syncState = 'remote';
        } else {
          if (this.fetchStatus?.isFetching && this.fetchStatus.sessionId === s.id) {
            if (this.fetchStatus.targetSessionIds) {
              s.remoteSessionIds = { ...(s.remoteSessionIds || {}), ...this.fetchStatus.targetSessionIds };
            }
            if (this.fetchStatus.remoteFrameCounts) {
              s.remoteFrameCounts = { ...(s.remoteFrameCounts || {}), ...this.fetchStatus.remoteFrameCounts };
            }
          }
          if (s.remoteFrameCounts) {
            for (const [camIp, expFrames] of Object.entries(s.remoteFrameCounts)) {
              const existingCam = this.findCameraEntryForIp(s.cameras, camIp, normConfig, s.meta);
              if (!existingCam && Number(expFrames) > 0) {
                const camIdx = normCameraIps.indexOf(camIp);
                const camMac = normalizeMacHex(this.knownCameraMacs?.[camIp]) || normalizeMacHex(normConfig?.cameraMacs?.[camIp]);
                const camFolder = this.getCameraFolderKeySync(camIp, normConfig);
                const camName = (camMac && (this.knownCameraNames?.[camMac] || normConfig?.cameraNames?.[camMac])) || this.knownCameraNames?.[camIp] || normConfig?.cameraNames?.[camIp] || null;
                s.cameras.push({
                  name: camFolder,
                  mac: camMac,
                  ip: camIp,
                  cameraName: camName,
                  cameraIndex: camIdx >= 0 ? camIdx : 999,
                  frameCount: 0
                });
              }
            }
            s.cameras.sort((a, b) => (a.cameraIndex ?? 999) - (b.cameraIndex ?? 999) || a.name.localeCompare(b.name));
          }

          const localFrames = (s.cameras || []).reduce((sum, c) => sum + (c.frameCount || 0), 0);
          s.totalFramesLocal = localFrames;
          let expected = localFrames;
          if (s.remoteFrameCounts) {
            const expSum = Object.values(s.remoteFrameCounts).reduce((a, b) => a + (Number(b) || 0), 0);
            if (expSum > 0) expected = Math.max(localFrames, expSum);
          }
          if (this.fetchStatus?.isFetching && this.fetchStatus.sessionId === s.id && this.fetchStatus.totalFramesExpected > expected) {
            expected = this.fetchStatus.totalFramesExpected;
          }
          s.totalFramesExpected = expected;

          const isCurrentlyFetchingThis = Boolean(this.fetchStatus?.isFetching && this.fetchStatus.sessionId === s.id);
          if (isCurrentlyFetchingThis && (localFrames < expected || expected === 0)) {
            s.isIncomplete = true;
            s.isSynced = false;
          }

          if (s.isSynced) {
            s.syncPercentage = 100;
            s.syncState = 'synced';
          } else if (s.isIncomplete || expected > localFrames) {
            s.syncPercentage = expected > 0 ? Math.min(99, Math.round((localFrames / expected) * 100)) : 0;
            s.syncState = 'partial';
          } else {
            s.syncPercentage = 100;
            s.syncState = 'synced';
          }
        }
      }

      return sessions.sort((a, b) => b.id.localeCompare(a.id));
    } catch (e) {
      return [];
    }
  }

  async compileVideo(sessionId, cameraKey, options = { fps: 30, quality: 23, rotation: 0, filterDark: true }) {
    this.isCompiling = true;
    const fps = Number(options?.fps) || 30;
    const quality = Number(options?.quality) || 23;
    const rotation = Number(options?.rotation) || 0;
    const filterDark = options?.filterDark !== false;

    let folderName;
    if (typeof cameraKey === 'string' && cameraKey.startsWith('camera_')) {
      folderName = cameraKey;
    } else if (typeof cameraKey === 'string' && /^[0-9A-Fa-f]{12}$/.test(cameraKey)) {
      folderName = `camera_${cameraKey.toUpperCase()}`;
    } else {
      const directCandidate = `camera_${cameraKey}`;
      if (existsSync(path.join(CAPTURES_DIR, sessionId, directCandidate))) {
        folderName = directCandidate;
      } else {
        const config = await this.getConfig();
        const ip = config?.cameraIps?.[Number(cameraKey)];
        folderName = ip ? this.getCameraFolderKeySync(ip, config) : directCandidate;
      }
    }

    this.log(`Starting video compilation for ${sessionId} (${folderName}, ${fps} FPS, rot=${rotation}°)...`, 'info');
    
    const camDir = path.join(CAPTURES_DIR, sessionId, folderName);
    const outputPath = path.join(CAPTURES_DIR, sessionId, `${folderName}.mp4`);
    const ffmpegPath = getFFmpegPath();

    try {
      const allFiles = await fs.readdir(camDir);
      const frameFiles = allFiles
        .filter(f => /^frame_\d+\.jpg$/i.test(f))
        .sort((a, b) => {
          const na = parseInt(a.replace(/\D+/g, ''), 10) || 0;
          const nb = parseInt(b.replace(/\D+/g, ''), 10) || 0;
          return na - nb;
        });

      if (frameFiles.length === 0) {
        this.isCompiling = false;
        throw new Error(`No frame_*.jpg files found in ${folderName}`);
      }

      // 1. Pre-filter empty or severely truncated files (<15 KB)
      const nonEmptyFrames = [];
      for (const f of frameFiles) {
        try {
          const st = await fs.stat(path.join(camDir, f));
          if (st.size >= 15000) {
            nonEmptyFrames.push(f);
          }
        } catch (e) {}
      }

      let validFrames = nonEmptyFrames;

      // 2. Pixel-level dark/green frame detection via FFmpeg blackframe filter (pblack >= 70% at threshold=40)
      if (filterDark && nonEmptyFrames.length > 3) {
        const analyzeListPath = path.join(camDir, '_ffmpeg_analyze.txt');
        const analyzeContent = nonEmptyFrames.map(f => `file '${path.join(camDir, f).replace(/\\/g, '/')}'`).join('\n') + '\n';
        await fs.writeFile(analyzeListPath, analyzeContent, 'utf-8');

        const darkIndices = new Set();
        await new Promise((resolve) => {
          const analyzeCmd = `"${ffmpegPath}" -hide_banner -f concat -safe 0 -i "${analyzeListPath}" -vf "blackframe=amount=0:threshold=40" -f null -`;
          exec(analyzeCmd, { cwd: camDir, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
            const output = (stderr || '') + '\n' + (stdout || '');
            const regex = /frame:\s*(\d+)\s+pblack:\s*(\d+)/g;
            let match;
            while ((match = regex.exec(output)) !== null) {
              const idx = parseInt(match[1], 10);
              const pblack = parseInt(match[2], 10);
              if (pblack >= 70) {
                darkIndices.add(idx);
              }
            }
            resolve();
          });
        });

        await fs.rm(analyzeListPath, { force: true }).catch(() => {});

        if (darkIndices.size > 0 && darkIndices.size < nonEmptyFrames.length) {
          validFrames = nonEmptyFrames.filter((_, idx) => !darkIndices.has(idx));
          this.log(`Filtered ${darkIndices.size} dark/underexposed frames from ${folderName} (${validFrames.length} clean frames kept).`, 'info');
        }
      }

      // 3. Write FFmpeg concat demuxer file so missing frame numbers never truncate the video
      const concatListPath = path.join(camDir, '_ffmpeg_concat.txt');
      const concatLines = validFrames.map(f => `file '${path.join(camDir, f).replace(/\\/g, '/')}'`);
      await fs.writeFile(concatListPath, concatLines.join('\n') + '\n', 'utf-8');

      // 4. Optional rotation filter (90° CW = transpose=1, 90° CCW = transpose=2, 180° = hflip,vflip)
      let vfArg = '';
      if (rotation === 90) {
        vfArg = '-vf "transpose=1" ';
      } else if (rotation === 270) {
        vfArg = '-vf "transpose=2" ';
      } else if (rotation === 180) {
        vfArg = '-vf "hflip,vflip" ';
      }

      const cmd = `"${ffmpegPath}" -y -r ${fps} -f concat -safe 0 -i "${concatListPath}" ${vfArg}-c:v libx264 -crf ${quality} -pix_fmt yuv420p "${outputPath}"`;

      return await new Promise((resolve, reject) => {
        exec(cmd, { cwd: camDir, maxBuffer: 16 * 1024 * 1024 }, async (error) => {
          this.isCompiling = false;
          await fs.rm(concatListPath, { force: true }).catch(() => {});
          if (error) {
            this.log(`FFmpeg failed: ${error.message}`, 'error');
            reject(error);
          } else {
            this.log(`Video compiled successfully: ${folderName}.mp4 (${validFrames.length} frames)`, 'success');
            resolve(outputPath);
          }
        });
      });
    } catch (err) {
      this.isCompiling = false;
      throw err;
    }
  }

  async deleteSession(sessionId) {
    if (sessionId.startsWith('remote_')) {
      const timestamp = sessionId.replace('remote_', '');
      const remoteEntry = this.remoteSessionsCache.find(s => s.id === sessionId || s.timestamp === timestamp);
      if (remoteEntry && remoteEntry.remoteSessionIds) {
        for (const [ip, remoteSid] of Object.entries(remoteEntry.remoteSessionIds)) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            await fetch(`http://${ip}/delete_session_sd?session=${remoteSid}`, { signal: controller.signal });
            clearTimeout(timeoutId);
          } catch (e) {}
        }
      }
      this.remoteSessionsCache = this.remoteSessionsCache.filter(s => s.id !== sessionId && s.timestamp !== timestamp);
      return;
    }

    if (!sessionId || typeof sessionId !== 'string' || !sessionId.startsWith('session_') || sessionId.includes('..')) {
      throw new Error('Invalid session ID');
    }
    const sessionDir = path.join(CAPTURES_DIR, sessionId);
    await fs.rm(sessionDir, { recursive: true, force: true });
    this.log(`Deleted session: ${sessionId}`, 'info');
  }

  async deleteAllSessions() {
    try {
      this.remoteSessionsCache = [];
      this.fetchStatus = null;
      try {
        await fs.unlink(path.join(CAPTURES_DIR, 'remote_sessions_cache.json'));
      } catch (e) {}
      await fs.mkdir(CAPTURES_DIR, { recursive: true });
      const entries = await fs.readdir(CAPTURES_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && (entry.name.startsWith('session_') || entry.name.startsWith('remote_'))) {
          await fs.rm(path.join(CAPTURES_DIR, entry.name), { recursive: true, force: true });
        }
      }
      this.log('All sessions deleted.', 'info');
    } catch (e) {
      this.log('Failed to delete all sessions: ' + e.message, 'error');
      throw e;
    }
  }

  async runCameraTest(webappUrl) {
    const config = await this.getConfig();
    if (!config || !config.cameraIps || config.cameraIps.length === 0) {
      throw new Error('No cameras configured.');
    }

    this.log('Starting camera test flow...', 'info');

    // 1. Fetch current status of all cameras to back up their original settings
    const camerasBackup = [];
    for (let i = 0; i < config.cameraIps.length; i++) {
      const ip = config.cameraIps[i];
      try {
        const res = await fetch(`http://${ip}/camera_status`);
        if (res.ok) {
          const data = await res.json();
          camerasBackup.push({
            ip,
            index: i,
            offline_mode: data.offline_mode ?? false,
            prusa_ip: data.prusa_ip ?? '',
            prusa_key: data.prusa_key ?? ''
          });
        } else {
          // If we can't query status, assume defaults or skip
          camerasBackup.push({ ip, index: i, offline_mode: false, prusa_ip: config.prusaIp || '', prusa_key: config.prusaApiKey || '' });
        }
      } catch (e) {
        camerasBackup.push({ ip, index: i, offline_mode: false, prusa_ip: config.prusaIp || '', prusa_key: config.prusaApiKey || '' });
      }
    }

    try {
      // 2. Set mock print active in webapp
      this.fakePrintActive = true;
      this.log('Fake print session started via PrusaLink status mock.', 'info');

      // 3. Configure all cameras to poll the webapp and enable offline mode
      for (const cam of camerasBackup) {
        try {
          this.log(`Configuring Camera ${cam.index} (${cam.ip}) to poll webapp: ${webappUrl}`, 'info');
          const res = await fetch(`http://${cam.ip}/control?var=offline&val=1&prusa_ip=${encodeURIComponent(webappUrl)}&prusa_key=test_key`);
          if (!res.ok) {
            this.log(`Failed to configure Camera ${cam.index} (${cam.ip}): Status ${res.status}`, 'warning');
          }
        } catch (e) {
          this.log(`Failed to configure Camera ${cam.index} (${cam.ip}): ${e.message}`, 'warning');
        }
      }

      // 4. Wait 3 seconds to let cameras poll and register PRINTING state (which creates their offline session)
      this.log('Waiting for cameras to register the new fake print session...', 'info');
      await new Promise(resolve => setTimeout(resolve, 3000));

      // 5. Capture 5 frames with a 2-second interval
      for (let f = 1; f <= 5; f++) {
        this.log(`Triggering test frame ${f}/5...`, 'info');
        
        // Trigger manual capture on all cameras
        const triggerResult = await this.manualTrigger();
        if (!triggerResult.success) {
          this.log(`Frame ${f} trigger had warnings/errors: ${triggerResult.error}`, 'warning');
        }
        
        // Wait 2 seconds before the next frame (only if not the last one)
        if (f < 5) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      // 6. Wait 2 seconds after the last frame
      await new Promise(resolve => setTimeout(resolve, 2000));

      // 7. End fake print session in webapp
      this.fakePrintActive = false;
      this.log('Fake print session ended via PrusaLink status mock.', 'info');

      // 8. Wait 3 seconds to let cameras poll one last time and save their session info to SD card
      this.log('Waiting for cameras to save session data...', 'info');
      await new Promise(resolve => setTimeout(resolve, 3000));

    } finally {
      // 9. Restore original settings to all cameras but update their Prusa IP
      this.fakePrintActive = false; // Ensure it's false in case of error
      this.log('Restoring original camera configurations and updating Prusa IP...', 'info');
      for (const cam of camerasBackup) {
        try {
          const val = cam.offline_mode ? 1 : 0;
          await fetch(`http://${cam.ip}/control?var=offline&val=${val}&prusa_ip=${encodeURIComponent(config.prusaIp || '')}&prusa_key=${encodeURIComponent(config.prusaApiKey || '')}`);
        } catch (e) {
          this.log(`Failed to restore configuration for Camera ${cam.index} (${cam.ip}): ${e.message}`, 'warning');
        }
      }
      this.log('Camera test flow complete.', 'success');
    }
  }
}

const globalForMonitor = globalThis;
if (!globalForMonitor.monitor) {
  globalForMonitor.monitor = new MonitorService();
}
export const monitor = globalForMonitor.monitor;
