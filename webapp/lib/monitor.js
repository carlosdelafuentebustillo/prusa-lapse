import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { existsSync, createWriteStream } from 'fs';
import * as tar from 'tar';

const CONFIG_FILE = path.join(process.cwd(), 'prusa-lapse.config.json');
const CAPTURES_DIR = path.join(process.cwd(), 'public', 'captures');

function getFFmpegPath() {
  const platform = process.platform;
  const arch = process.arch;
  let platformDir = '';
  let binaryName = 'ffmpeg';

  if (platform === 'win32') {
    platformDir = `win32-${arch}`;
    binaryName = 'ffmpeg.exe';
  } else if (platform === 'darwin') {
    platformDir = `darwin-${arch}`;
  } else if (platform === 'linux') {
    platformDir = `linux-${arch}`;
  }

  const localPath = path.join(
    process.cwd(),
    'node_modules',
    '@ffmpeg-installer',
    platformDir,
    binaryName
  );

  const explicitWinPath = path.join(process.cwd(), 'node_modules', '@ffmpeg-installer', 'win32-x64', 'ffmpeg.exe');
  if (platform === 'win32') return explicitWinPath; // Hardcode for windows workspace since existsSync might fail in Turbopack
  
  if (platformDir && existsSync(localPath)) {
    return localPath;
  }
  
  // Fallback to nested node_modules
  const nestedPath = path.join(process.cwd(), 'node_modules', '@ffmpeg-installer', 'ffmpeg', 'node_modules', '@ffmpeg-installer', platformDir, binaryName);
  if (platformDir && existsSync(nestedPath)) return nestedPath;

  return 'ffmpeg'; // fallback to system PATH
}

function generateSessionTimestamp(date = new Date()) {
  return date.getFullYear() +
    String(date.getMonth() + 1).padStart(2, '0') +
    String(date.getDate()).padStart(2, '0') + '_' +
    String(date.getHours()).padStart(2, '0') +
    String(date.getMinutes()).padStart(2, '0') +
    String(date.getSeconds()).padStart(2, '0');
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
    this.log('PrusaLapse Webapp System initialized. Awaiting commands...', 'info');
  }

  log(message, type = 'info') {
    const time = new Date().toLocaleTimeString();
    this.logs.push({ time, message, type });
    if (this.logs.length > 100) this.logs.shift();
    console.log(`[${time}] ${message}`);
  }

  async getConfig() {
    try {
      const data = await fs.readFile(CONFIG_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (e) {
      return null;
    }
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
          
          // Ensure path exists
          const dirPath = path.join(CAPTURES_DIR, this.currentSession, `camera_${cameraIndex}`);
          await fs.mkdir(dirPath, { recursive: true });
          
          if (!this.localFrameCounts) {
            this.localFrameCounts = {};
          }
          const currentCount = this.localFrameCounts[cameraIndex] || 0;
          
          // Save image file
          const filename = `frame_${String(currentCount).padStart(4, '0')}.jpg`;
          const filePath = path.join(dirPath, filename);
          await fs.writeFile(filePath, buffer);
          
          this.localFrameCounts[cameraIndex] = currentCount + 1;
          
          this.log(`Camera ${cameraIndex} (${ip}) downloaded frame ${currentCount} successfully`, 'success');
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
            const currentFrameCount = data.frame_count || 0;
            const lastKnown = this.remoteFrameCounts[ip] || 0;

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

    this.intervalId = setTimeout(() => this.pollCameras(config), 2000);
  }

  stop() {
    if (!this.isRunning) return;
    clearTimeout(this.intervalId);
    this.isRunning = false;
    this.log(`PC Backup Sync stopped. Synced ${this.frameCount} frames to local PC.`, 'info');
  }

  async fetchOfflineSession(targetSessionIds = null, sessionTimestamp = null) {
    if (this.isCompiling) {
      this.log('Cannot fetch offline session while compiling.', 'error');
      throw new Error('Monitor is busy compiling');
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
    
    const sessionId = `session_offline_${timestamp}`;
    const sessionDir = path.join(CAPTURES_DIR, sessionId);
    await fs.mkdir(sessionDir, { recursive: true });
    
    this.log(`Started fetching offline session: ${sessionId}`, 'info');

    let totalFramesFetched = 0;
    let hasError = false;
    let errors = [];

    for (let i = 0; i < config.cameraIps.length; i++) {
      const ip = config.cameraIps[i];
      const targetSessionId = targetSessionIds ? targetSessionIds[ip] : null;
  
        if (targetSessionIds && !targetSessionId) {
          this.log(`Camera ${i} (${ip}) has no remote session ID for this timestamp. Skipping.`, 'info');
          continue;
        }

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);
          const listRes = await fetch(`http://${ip}/list_sd`, {
            headers: { 'Connection': 'close' },
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          
          if (!listRes.ok) {
          this.log(`Camera ${i} (${ip}) failed to list SD card files: ${listRes.status}`, 'error');
          hasError = true;
          errors.push(`Camera ${i} failed to list files: ${listRes.status}`);
          continue;
        }
        
        const files = await listRes.json();
        if (!files || files.length === 0) {
          this.log(`Camera ${i} (${ip}) has no files on SD card.`, 'info');
          continue;
        }

        const camDir = path.join(sessionDir, `camera_${i}`);
        await fs.mkdir(camDir, { recursive: true });

        // Fast path: Check if the TAR file exists!
        if (targetSessionId && files.some(f => f.includes(`${targetSessionId}.tar`))) {
          this.log(`Camera ${i} (${ip}) found pre-packed ${targetSessionId}.tar! Fast downloading...`, 'success');
          try {
            const tarRes = await fetch(`http://${ip}/download_sd?file=${targetSessionId}.tar`, {
              headers: { 'Connection': 'close' }
            });
            if (tarRes.ok) {
              this.fetchStatus = {
                isFetching: true,
                progress: 0,
                currentCameraIndex: i,
                totalCameras: config.cameraIps.length
              };
              
              const tarPath = path.join(camDir, `${targetSessionId}.tar`);
              const totalBytes = Number(tarRes.headers.get('content-length')) || 0;
              let downloadedBytes = 0;
              
              const fileStream = createWriteStream(tarPath);
              for await (const chunk of tarRes.body) {
                fileStream.write(chunk);
                downloadedBytes += chunk.length;
                if (totalBytes > 0) {
                  this.fetchStatus.progress = Math.round((downloadedBytes / totalBytes) * 100);
                }
              }
              fileStream.end();
              
              // Extract tar
              await tar.x({
                file: tarPath,
                cwd: camDir
              });
              
              // Count extracted files and rename them
              const extracted = await fs.readdir(camDir);
              const jpgs = extracted.filter(f => f.endsWith('.jpg'));
              
              for (const jf of jpgs) {
                 if (jf.startsWith('s') && jf.includes('_f')) {
                   const parts = jf.split('_f');
                   if (parts.length === 2) {
                     const frameIndexStr = parts[1].replace('.jpg', '');
                     const saveFilename = `frame_${frameIndexStr.padStart(4, '0')}.jpg`;
                     await fs.rename(path.join(camDir, jf), path.join(camDir, saveFilename));
                   }
                 }
              }
              
              await fs.rm(tarPath);
              totalFramesFetched += jpgs.length;
              this.log(`Camera ${i} (${ip}) extracted ${jpgs.length} frames from TAR successfully.`, 'success');
              continue; // Skip the individual file fallback!
            } else {
              this.log(`Camera ${i} (${ip}) TAR download failed: ${tarRes.status}. Falling back to individual JPGs.`, 'warning');
            }
          } catch(e) {
            this.log(`Camera ${i} (${ip}) TAR extraction failed: ${e.message}. Falling back to individual JPGs.`, 'warning');
          }
        }

        this.log(`Camera ${i} (${ip}) downloading individual files...`, 'info');

        const targetFiles = files.filter(f => {
          const file = f.split('/').pop();
          if (file === 'sessions.jsonl' || file === 'config.txt') return false;
          if (targetSessionId && !file.startsWith(targetSessionId + '_')) return false;
          return true;
        });
        
        const totalFiles = targetFiles.length;
        let downloadedFiles = 0;
        
        this.fetchStatus = {
          isFetching: true,
          progress: 0,
          currentCameraIndex: i,
          totalCameras: config.cameraIps.length
        };

        for (const fileStr of files) {
          const file = fileStr.split('/').pop(); // Ensure it's just the filename
          if (file === 'sessions.jsonl' || file === 'config.txt') continue;
          if (targetSessionId && !file.startsWith(targetSessionId + '_')) continue;
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            const dlRes = await fetch(`http://${ip}/download_sd?file=${file}`, {
              headers: { 'Connection': 'close' },
              signal: controller.signal
            });
            clearTimeout(timeoutId);
            
            if (dlRes.ok) {
              const arrayBuffer = await dlRes.arrayBuffer();
              const buffer = Buffer.from(arrayBuffer);
              
              let saveFilename = file;
              if (file.startsWith('s') && file.includes('_f')) {
                const parts = file.split('_f');
                if (parts.length === 2) {
                  const frameIndexStr = parts[1].replace('.jpg', '');
                  saveFilename = `frame_${frameIndexStr.padStart(4, '0')}.jpg`;
                }
              }

              const filePath = path.join(camDir, saveFilename);
              await fs.writeFile(filePath, buffer);
              totalFramesFetched++;
              
              downloadedFiles++;
              if (totalFiles > 0) {
                this.fetchStatus.progress = Math.round((downloadedFiles / totalFiles) * 100);
              }
            } else {
              this.log(`Camera ${i} (${ip}) failed to download ${file}: ${dlRes.status}`, 'error');
              hasError = true;
              errors.push(`Camera ${i} download failed for ${file}`);
            }
          } catch(e) {
             this.log(`Camera ${i} (${ip}) failed to download ${file}: ${e.message}`, 'error');
             hasError = true;
             errors.push(`Camera ${i} download failed for ${file}`);
          }
        }
        this.log(`Camera ${i} (${ip}) download complete.`, 'success');

      } catch (err) {
        this.log(`Camera ${i} (${ip}) unreachable for SD card fetch: ${err.message}`, 'error');
        hasError = true;
        errors.push(`Camera ${i} unreachable`);
      }
    }

    if (totalFramesFetched === 0) {
      await fs.rm(sessionDir, { recursive: true, force: true });
      this.log('Offline fetch aborted. No files were downloaded.', 'warning');
      return { success: false, error: 'No files downloaded. ' + errors.join('. ') };
    }
    
    if (hasError) {
      this.log(`Offline session fetch completed with errors. Downloaded ${totalFramesFetched} total frames.`, 'warning');
      return { success: false, error: `Fetched ${totalFramesFetched} frames, but with errors: ` + errors.join('. '), sessionId };
    }

    this.log(`Offline session fetch complete. Downloaded ${totalFramesFetched} total frames.`, 'success');
    
    // Rename the session directory to remove '_offline'
    const newSessionId = sessionId.replace('_offline', '');
    const newSessionDir = path.join(CAPTURES_DIR, newSessionId);
    
    try {
      await fs.rename(sessionDir, newSessionDir);
      this.log(`Session is no longer considered offline. Renamed to ${newSessionId}.`, 'info');
      return { success: true, sessionId: newSessionId };
    } catch (renameErr) {
      this.log(`Failed to rename session directory: ${renameErr.message}`, 'warning');
      return { success: true, sessionId }; 
    }
  }

  async wipeOfflineSD() {
    const config = await this.getConfig();
    if (!config || !config.cameraIps || config.cameraIps.length === 0) {
      this.log('Cannot wipe: No cameras configured.', 'error');
      throw new Error('No cameras configured');
    }
    
    this.log('Wiping SD cards on all cameras...', 'warning');
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
    return {
      isRunning: this.isRunning,
      currentSession: this.currentSession,
      frameCount: this.frameCount,
      isCompiling: this.isCompiling,
      logs: this.logs,
      fetchStatus: this.fetchStatus
    };
  }

  async getSessions(includeRemote = false) {
    try {
      await fs.mkdir(CAPTURES_DIR, { recursive: true });
      const entries = await fs.readdir(CAPTURES_DIR, { withFileTypes: true });
      const sessions = [];
      
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('session_')) {
          const sessionPath = path.join(CAPTURES_DIR, entry.name);
          const cameras = [];
          const items = await fs.readdir(sessionPath, { withFileTypes: true });
          
          let videos = [];
          for (const item of items) {
            if (item.isDirectory() && item.name.startsWith('camera_')) {
              const camPath = path.join(sessionPath, item.name);
              const files = await fs.readdir(camPath);
              const frameFiles = files.filter(f => f.startsWith('frame_') && f.endsWith('.jpg'));
              cameras.push({
                name: item.name,
                frameCount: frameFiles.length,
              });
            } else if (item.isFile() && item.name.endsWith('.mp4')) {
              videos.push(item.name);
            }
          }
          
          const isOffline = entry.name.startsWith('session_offline_');
          let timestamp = entry.name.replace('session_', '');
          if (isOffline) {
            timestamp = entry.name.replace('session_offline_', '');
          }
          
          sessions.push({
            id: entry.name,
            timestamp,
            isOffline,
            cameras,
            videos
          });
        }
      }
      
      // Fetch remote sessions only if explicitly requested (e.g. Refresh button clicked)
      if (includeRemote) {
        this.remoteSessionsCache = [];
        const config = await this.getConfig();
        if (config && config.cameraIps) {
          for (const ip of config.cameraIps) {
            try {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 5000);
              const res = await fetch(`http://${ip}/download_sd?file=sessions.jsonl`, {
                headers: { 'Connection': 'close' },
                signal: controller.signal
              });
              clearTimeout(timeoutId);
              
              if (res.ok) {
                const text = await res.text();
                const lines = text.split('\n');
                for (const line of lines) {
                  if (line.trim()) {
                    try {
                      const data = JSON.parse(line);
                      let timestamp = data.timestamp; // "2026-06-09T20:39:15"
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
                          targetDate = new Date();
                          timestamp = generateSessionTimestamp(targetDate);
                        }
                      } else {
                        targetDate = new Date();
                        timestamp = generateSessionTimestamp(targetDate);
                      }
                      
                      // Check if we already fetched this exact offline session locally
                      const alreadyFetched = sessions.some(s => s.timestamp === timestamp && s.isOffline && !s.isRemote);
                      
                      if (!alreadyFetched) {
                        // Check if we have a remote session within 2 minutes (120000 ms) of this timestamp to group them
                        const existingRemote = this.remoteSessionsCache.find(s => {
                          return Math.abs(s.originalDate - targetDate.getTime()) < 120000;
                        });
                        
                        if (existingRemote) {
                          existingRemote.cameras.push({ name: `camera_${existingRemote.cameras.length}`, frameCount: data.frames, ip: ip });
                          existingRemote.remoteSessionIds[ip] = data.session;
                        } else {
                          this.remoteSessionsCache.push({
                            id: `remote_${timestamp}`,
                            timestamp: timestamp,
                            originalDate: targetDate.getTime(), // Store raw time for grouping subsequent cameras
                            isOffline: true,
                            isRemote: true,
                            remoteSessionIds: { [ip]: data.session },
                            cameras: [{ name: `camera_0`, frameCount: data.frames, ip: ip }],
                            videos: []
                          });
                        }
                      }
                    } catch (e) {}
                  }
                }
              }
            } catch(e) {}
          }
        }
      }

      // Add cached remote sessions to the local sessions
      sessions.push(...this.remoteSessionsCache);

      return sessions.sort((a, b) => b.id.localeCompare(a.id));
    } catch (e) {
      return [];
    }
  }

  async compileVideo(sessionId, cameraIndex, options = { fps: 30, quality: 23 }) {
    this.isCompiling = true;
    this.log(`Starting video compilation for ${sessionId} (Camera ${cameraIndex})...`, 'info');
    
    const inputPattern = path.join(CAPTURES_DIR, sessionId, `camera_${cameraIndex}`, 'frame_%04d.jpg');
    const outputPath = path.join(CAPTURES_DIR, sessionId, `camera_${cameraIndex}.mp4`);
    
    const ffmpegPath = getFFmpegPath();
    const cmd = `"${ffmpegPath}" -y -framerate ${options.fps} -i "${inputPattern}" -c:v libx264 -crf ${options.quality} -pix_fmt yuv420p "${outputPath}"`;
    
    return new Promise((resolve, reject) => {
      exec(cmd, (error, stdout, stderr) => {
        this.isCompiling = false;
        if (error) {
          this.log(`FFmpeg failed: ${error.message}`, 'error');
          reject(error);
        } else {
          this.log(`Video compiled successfully: camera_${cameraIndex}.mp4`, 'success');
          resolve(outputPath);
        }
      });
    });
  }

  async deleteSession(sessionId) {
    if (sessionId.startsWith('remote_')) {
      const parts = sessionId.split('_');
      if (parts.length >= 3) {
        const ip = parts[1];
        const remoteSessionId = parts[2];
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          const res = await fetch(`http://${ip}/delete_session_sd?session=${remoteSessionId}`, { signal: controller.signal });
          clearTimeout(timeoutId);
          if (res.ok) {
            this.log(`Deleted remote session ${remoteSessionId} from camera ${ip}`, 'info');
            return;
          } else {
            throw new Error(`Camera returned status ${res.status}`);
          }
        } catch (e) {
          this.log(`Failed to delete remote session: ${e.message}`, 'error');
          throw e;
        }
      }
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
      const sessions = await this.getSessions();
      for (const s of sessions) {
        const sessionDir = path.join(CAPTURES_DIR, s.id);
        await fs.rm(sessionDir, { recursive: true, force: true });
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
