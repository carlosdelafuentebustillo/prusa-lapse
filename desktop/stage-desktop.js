const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const standaloneDir = path.join(rootDir, 'webapp', '.next', 'standalone');
const desktopApp = path.join(rootDir, 'desktop', 'app');
const desktopBin = path.join(rootDir, 'desktop', 'bin');

console.log('[Desktop Stager] Preparing desktop staging directories...');
if (!fs.existsSync(desktopApp)) fs.mkdirSync(desktopApp, { recursive: true });
if (!fs.existsSync(desktopBin)) fs.mkdirSync(desktopBin, { recursive: true });

console.log('[Desktop Stager] Copying standalone bundle to desktop/app...');
execSync(`powershell -NoProfile -Command "Copy-Item -Path '${standaloneDir}\\*' -Destination '${desktopApp}' -Recurse -Force"`);
execSync(`powershell -NoProfile -Command "Copy-Item -Path '${path.join(rootDir, 'webapp', '.next', 'static')}' -Destination '${path.join(desktopApp, '.next', 'static')}' -Recurse -Force"`);
execSync(`powershell -NoProfile -Command "Copy-Item -Path '${path.join(rootDir, 'webapp', 'public')}' -Destination '${path.join(desktopApp, 'public')}' -Recurse -Force"`);

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
