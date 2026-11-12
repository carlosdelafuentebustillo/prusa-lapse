const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const standaloneDir = path.join(rootDir, 'webapp', '.next', 'standalone');
const desktopApp = path.join(rootDir, 'desktop', 'app');
const desktopBin = path.join(rootDir, 'desktop', 'bin');

console.log('[Desktop Stager] Preparing desktop staging directories...');
if (fs.existsSync(desktopApp)) {
  fs.rmSync(desktopApp, { recursive: true, force: true });
}
fs.mkdirSync(desktopApp, { recursive: true });
if (!fs.existsSync(desktopBin)) {
  fs.mkdirSync(desktopBin, { recursive: true });
}

console.log('[Desktop Stager] Copying standalone bundle to desktop/app...');
fs.cpSync(standaloneDir, desktopApp, { recursive: true });

console.log('[Desktop Stager] Copying .next/static into desktop/app/.next/static...');
const srcStatic = path.join(rootDir, 'webapp', '.next', 'static');
const destStatic = path.join(desktopApp, '.next', 'static');
if (fs.existsSync(destStatic)) {
  fs.rmSync(destStatic, { recursive: true, force: true });
}
fs.cpSync(srcStatic, destStatic, { recursive: true });

console.log('[Desktop Stager] Copying public into desktop/app/public...');
const srcPublic = path.join(rootDir, 'webapp', 'public');
const destPublic = path.join(desktopApp, 'public');
if (fs.existsSync(destPublic)) {
  fs.rmSync(destPublic, { recursive: true, force: true });
}
fs.cpSync(srcPublic, destPublic, { recursive: true });

// Ensure latest compiled ESP32-CAM firmware.bin and its version metadata are staged for OTA updates
const builtFirmwareBin = path.join(rootDir, 'firmware', '.pio', 'build', 'esp32cam', 'firmware.bin');
if (fs.existsSync(builtFirmwareBin)) {
  fs.copyFileSync(builtFirmwareBin, path.join(srcPublic, 'firmware.bin'));
  fs.copyFileSync(builtFirmwareBin, path.join(destPublic, 'firmware.bin'));
}
const firmwareMainCpp = path.join(rootDir, 'firmware', 'src', 'main.cpp');
if (fs.existsSync(firmwareMainCpp)) {
  const fwMatch = fs.readFileSync(firmwareMainCpp, 'utf8').match(/#define\s+FIRMWARE_VERSION\s+"([^"]+)"/);
  if (fwMatch && fwMatch[1]) {
    fs.writeFileSync(path.join(destPublic, 'firmware-version.txt'), fwMatch[1] + '\n', 'utf8');
  }
}

console.log('[Desktop Stager] Copying ffmpeg and curl binaries to desktop/bin...');
const ffmpegSrc = path.join(rootDir, 'webapp', 'node_modules', '@ffmpeg-installer', 'win32-x64', 'ffmpeg.exe');
if (fs.existsSync(ffmpegSrc)) {
  fs.copyFileSync(ffmpegSrc, path.join(desktopBin, 'ffmpeg.exe'));
}

const sysCurl = 'C:\\Windows\\System32\\curl.exe';
if (fs.existsSync(sysCurl)) {
  fs.copyFileSync(sysCurl, path.join(desktopBin, 'curl.exe'));
}

console.log('[Desktop Stager] Copying orcaslicer-plugin to desktop/app...');
const pluginSrc = path.join(rootDir, 'orcaslicer-plugin', 'prusalapse');
const pluginDest = path.join(desktopApp, 'orcaslicer-plugin', 'prusalapse');
if (fs.existsSync(pluginSrc)) {
  fs.mkdirSync(pluginDest, { recursive: true });
  fs.cpSync(pluginSrc, pluginDest, {
    recursive: true,
    force: true,
    filter: (srcPath) => !srcPath.includes('__pycache__') && !srcPath.endsWith('.pyc')
  });
}

console.log('[Desktop Stager] Staging complete!');
