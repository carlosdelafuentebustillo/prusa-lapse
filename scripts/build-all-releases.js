const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');
const crypto = require('crypto');
const AdmZip = require('../webapp/node_modules/adm-zip');
const tar = require('../webapp/node_modules/tar');

const VERSION = '1.3.0';
const ROOT_DIR = path.resolve(__dirname, '..');
const RELEASE_DIR = path.join(ROOT_DIR, 'releases', `v${VERSION}`);
const STAGING_DIR = path.join(ROOT_DIR, 'dist', 'staging');
const CACHE_DIR = path.join(ROOT_DIR, 'dist', 'cache');

console.log('================================================================');
console.log(`        PRUSALAPSE MASTER RELEASE BUILD PIPELINE (v${VERSION})   `);
console.log('================================================================');
console.log(`Root Directory:    ${ROOT_DIR}`);
console.log(`Release Directory: ${RELEASE_DIR}`);
console.log();

// Ensure clean directories
[RELEASE_DIR, STAGING_DIR, CACHE_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Helper: Compute SHA-256 checksum
function computeSha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

// Helper: Download file if not in cache
function ensureDownload(url, destPath) {
  if (fs.existsSync(destPath) && fs.statSync(destPath).size > 1000000) {
    console.log(`  [CACHE HIT] ${path.basename(destPath)}`);
    return;
  }
  console.log(`  [DOWNLOADING] ${url} ...`);
  const tmpPath = destPath + '.tmp';
  execSync(`curl.exe -L -o "${tmpPath}" "${url}"`, { stdio: 'inherit' });
  fs.renameSync(tmpPath, destPath);
  console.log(`  [DOWNLOADED] ${path.basename(destPath)} (${(fs.statSync(destPath).size / 1024 / 1024).toFixed(1)} MB)`);
}

// ============================================================================
// STEP 1: ESP32-CAM FIRMWARE RELEASE PACKAGE
// ============================================================================
console.log('\n--- Step 1: Packaging ESP32-CAM Firmware v1.3.0 ---');
const pioBuildDir = path.join(ROOT_DIR, 'firmware', '.pio', 'build', 'esp32cam');
const fwBin = path.join(pioBuildDir, 'firmware.bin');
const blBin = path.join(pioBuildDir, 'bootloader.bin');
const ptBin = path.join(pioBuildDir, 'partitions.bin');

if (!fs.existsSync(fwBin)) {
  console.log('  Compiling firmware with PlatformIO...');
  execSync('pio run -d firmware', { cwd: ROOT_DIR, stdio: 'inherit' });
}

// Sync to webapp public
fs.copyFileSync(fwBin, path.join(ROOT_DIR, 'webapp', 'public', 'firmware.bin'));

const fwZip = new AdmZip();
fwZip.addLocalFile(fwBin, '', 'firmware.bin');
if (fs.existsSync(blBin)) fwZip.addLocalFile(blBin, '', 'bootloader.bin');
if (fs.existsSync(ptBin)) fwZip.addLocalFile(ptBin, '', 'partitions.bin');

const fwBat = path.join(ROOT_DIR, 'deploy', 'firmware', 'flash-firmware-windows.bat');
const fwSh = path.join(ROOT_DIR, 'deploy', 'firmware', 'flash-firmware-linux.sh');
const fwReadme = path.join(ROOT_DIR, 'deploy', 'firmware', 'README.md');

if (fs.existsSync(fwBat)) fwZip.addLocalFile(fwBat, '', 'flash-firmware-windows.bat');
if (fs.existsSync(fwSh)) fwZip.addLocalFile(fwSh, '', 'flash-firmware-linux.sh');
if (fs.existsSync(fwReadme)) fwZip.addLocalFile(fwReadme, '', 'README.md');

const fwZipPath = path.join(RELEASE_DIR, `prusalapse-v${VERSION}-firmware.zip`);
fwZip.writeZip(fwZipPath);
console.log(`✓ Created: ${path.basename(fwZipPath)} (${(fs.statSync(fwZipPath).size / 1024 / 1024).toFixed(2)} MB)`);

// ============================================================================
// STEP 2: BUILD NEXT.JS STANDALONE APPLICATION
// ============================================================================
console.log('\n--- Step 2: Building Webapp in Next.js Standalone Mode ---');
execSync('npm run build', { cwd: path.join(ROOT_DIR, 'webapp'), stdio: 'inherit' });

const standaloneDir = path.join(ROOT_DIR, 'webapp', '.next', 'standalone');
const nextStaticSrc = path.join(ROOT_DIR, 'webapp', '.next', 'static');
const nextStaticDest = path.join(standaloneDir, '.next', 'static');
const publicSrc = path.join(ROOT_DIR, 'webapp', 'public');
const publicDest = path.join(standaloneDir, 'public');

// Copy static assets into standalone bundle
console.log('  Copying static assets into standalone bundle...');
execSync(`powershell -NoProfile -Command "Copy-Item -Path '${nextStaticSrc}' -Destination '${nextStaticDest}' -Recurse -Force"`);
execSync(`powershell -NoProfile -Command "Copy-Item -Path '${publicSrc}' -Destination '${publicDest}' -Recurse -Force"`);

// ============================================================================
// STEP 3: SERVER STANDALONE PACKAGE
// ============================================================================
console.log('\n--- Step 3: Packaging Server Standalone Bundle ---');
const serverStageDir = path.join(STAGING_DIR, 'server-standalone');
if (fs.existsSync(serverStageDir)) fs.rmSync(serverStageDir, { recursive: true, force: true });
fs.mkdirSync(serverStageDir, { recursive: true });

// Copy standalone directory contents
execSync(`powershell -NoProfile -Command "Copy-Item -Path '${standaloneDir}\\*' -Destination '${serverStageDir}' -Recurse -Force"`);

// Add systemd service and docker files to server bundle
const deployDir = path.join(serverStageDir, 'deploy');
fs.mkdirSync(deployDir, { recursive: true });
fs.copyFileSync(path.join(ROOT_DIR, 'deploy', 'systemd', 'prusalapse.service'), path.join(deployDir, 'prusalapse.service'));
fs.copyFileSync(path.join(ROOT_DIR, 'deploy', 'DOCKER_DEPLOYMENT.md'), path.join(serverStageDir, 'DOCKER_DEPLOYMENT.md'));
fs.copyFileSync(path.join(ROOT_DIR, 'Dockerfile'), path.join(serverStageDir, 'Dockerfile'));
fs.copyFileSync(path.join(ROOT_DIR, 'docker-compose.yml'), path.join(serverStageDir, 'docker-compose.yml'));

// Helper start scripts for server bundle
fs.writeFileSync(path.join(serverStageDir, 'start-server.bat'), '@echo off\r\nset PORT=3000\r\nset HOSTNAME=0.0.0.0\r\nset NODE_ENV=production\r\nnode server.js\r\npause\r\n');
fs.writeFileSync(path.join(serverStageDir, 'start-server.sh'), '#!/usr/bin/env bash\r\nexport PORT=3000\r\nexport HOSTNAME=0.0.0.0\r\nexport NODE_ENV=production\r\nexec node server.js\r\n');

const serverZipPath = path.join(RELEASE_DIR, `prusalapse-v${VERSION}-server-standalone.zip`);
const serverZip = new AdmZip();
serverZip.addLocalFolder(serverStageDir, '');
serverZip.writeZip(serverZipPath);
console.log(`✓ Created: ${path.basename(serverZipPath)} (${(fs.statSync(serverZipPath).size / 1024 / 1024).toFixed(2)} MB)`);

// ============================================================================
// STEP 4: WINDOWS PORTABLE APPLICATION (x64)
// ============================================================================
console.log('\n--- Step 4: Packaging Windows Portable Application ---');
const winStageDir = path.join(STAGING_DIR, `prusalapse-v${VERSION}-windows-x64`);
if (fs.existsSync(winStageDir)) fs.rmSync(winStageDir, { recursive: true, force: true });
fs.mkdirSync(winStageDir, { recursive: true });

// 1. Download / Cache portable node.exe (Windows x64)
const nodeWinUrl = 'https://nodejs.org/dist/v20.18.0/win-x64/node.exe';
const cachedNodeExe = path.join(CACHE_DIR, 'node-v20.18.0-win-x64.exe');
ensureDownload(nodeWinUrl, cachedNodeExe);

const winRuntimeDir = path.join(winStageDir, 'runtime');
fs.mkdirSync(winRuntimeDir, { recursive: true });
fs.copyFileSync(cachedNodeExe, path.join(winRuntimeDir, 'node.exe'));

// 2. Bundle Binaries (ffmpeg.exe and curl.exe)
const winBinDir = path.join(winStageDir, 'bin');
fs.mkdirSync(winBinDir, { recursive: true });
const winFfmpegSrc = path.join(ROOT_DIR, 'webapp', 'node_modules', '@ffmpeg-installer', 'win32-x64', 'ffmpeg.exe');
if (fs.existsSync(winFfmpegSrc)) {
  fs.copyFileSync(winFfmpegSrc, path.join(winBinDir, 'ffmpeg.exe'));
}
const sysCurl = 'C:\\Windows\\System32\\curl.exe';
if (fs.existsSync(sysCurl)) {
  fs.copyFileSync(sysCurl, path.join(winBinDir, 'curl.exe'));
}

// 3. Compile Native Windows Launcher (PrusaLapse.exe)
const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
const launcherCs = path.join(ROOT_DIR, 'deploy', 'windows', 'launcher.cs');
const icoPath = path.join(ROOT_DIR, 'prusalapse.ico');
const winExeOut = path.join(winStageDir, 'PrusaLapse.exe');

console.log('  Compiling PrusaLapse.exe native Windows launcher...');
execSync(`"${cscPath}" /nologo /win32icon:"${icoPath}" /out:"${winExeOut}" "${launcherCs}"`, { stdio: 'inherit' });

// 4. Copy fallback batch launcher and README
fs.copyFileSync(path.join(ROOT_DIR, 'deploy', 'windows', 'PrusaLapse.bat'), path.join(winStageDir, 'PrusaLapse.bat'));
fs.copyFileSync(path.join(ROOT_DIR, 'deploy', 'windows', 'README.md'), path.join(winStageDir, 'README.md'));

// 5. Copy Next.js Standalone Application to app/
const winAppDir = path.join(winStageDir, 'app');
fs.mkdirSync(winAppDir, { recursive: true });
execSync(`powershell -NoProfile -Command "Copy-Item -Path '${standaloneDir}\\*' -Destination '${winAppDir}' -Recurse -Force"`);

// 6. Zip Windows Portable package
const winZipPath = path.join(RELEASE_DIR, `prusalapse-v${VERSION}-windows-x64.zip`);
console.log('  Zipping Windows portable package...');
const winZip = new AdmZip();
winZip.addLocalFolder(winStageDir, `prusalapse-v${VERSION}-windows-x64`);
winZip.writeZip(winZipPath);
console.log(`✓ Created: ${path.basename(winZipPath)} (${(fs.statSync(winZipPath).size / 1024 / 1024).toFixed(2)} MB)`);

// ============================================================================
// STEP 5: LINUX PORTABLE APPLICATION (x64)
// ============================================================================
console.log('\n--- Step 5: Packaging Linux Portable Application ---');
const linuxStageDir = path.join(STAGING_DIR, `prusalapse-v${VERSION}-linux-x64`);
if (fs.existsSync(linuxStageDir)) fs.rmSync(linuxStageDir, { recursive: true, force: true });
fs.mkdirSync(linuxStageDir, { recursive: true });

// 1. Download / Extract Linux x64 Node.js binary
const nodeLinuxUrl = 'https://nodejs.org/dist/v20.18.0/node-v20.18.0-linux-x64.tar.gz';
const cachedNodeTar = path.join(CACHE_DIR, 'node-v20.18.0-linux-x64.tar.gz');
ensureDownload(nodeLinuxUrl, cachedNodeTar);

const linuxRuntimeBinDir = path.join(linuxStageDir, 'runtime', 'bin');
fs.mkdirSync(linuxRuntimeBinDir, { recursive: true });

console.log('  Extracting Linux node binary from tar.gz...');
tar.extract({
  file: cachedNodeTar,
  cwd: CACHE_DIR,
  filter: (path) => path.endsWith('/bin/node'),
  sync: true,
});

const extractedNode = path.join(CACHE_DIR, 'node-v20.18.0-linux-x64', 'bin', 'node');
if (fs.existsSync(extractedNode)) {
  fs.copyFileSync(extractedNode, path.join(linuxRuntimeBinDir, 'node'));
}

// 2. Copy Linux launcher scripts and desktop entries
fs.copyFileSync(path.join(ROOT_DIR, 'deploy', 'linux', 'prusalapse'), path.join(linuxStageDir, 'prusalapse'));
fs.copyFileSync(path.join(ROOT_DIR, 'deploy', 'linux', 'prusalapse.desktop'), path.join(linuxStageDir, 'prusalapse.desktop'));
fs.copyFileSync(path.join(ROOT_DIR, 'deploy', 'linux', 'README.md'), path.join(linuxStageDir, 'README.md'));

// 3. Copy Next.js Standalone Application to app/
const linuxAppDir = path.join(linuxStageDir, 'app');
fs.mkdirSync(linuxAppDir, { recursive: true });
execSync(`powershell -NoProfile -Command "Copy-Item -Path '${standaloneDir}\\*' -Destination '${linuxAppDir}' -Recurse -Force"`);

// 4. Create tar.gz for Linux (preserves POSIX permissions)
const linuxTarPath = path.join(RELEASE_DIR, `prusalapse-v${VERSION}-linux-x64.tar.gz`);
console.log('  Creating Linux tar.gz package...');
tar.create(
  {
    gzip: true,
    file: linuxTarPath,
    cwd: STAGING_DIR,
    portable: true,
    sync: true
  },
  [`prusalapse-v${VERSION}-linux-x64`]
);
console.log(`✓ Created: ${path.basename(linuxTarPath)} (${(fs.statSync(linuxTarPath).size / 1024 / 1024).toFixed(2)} MB)`);

// ============================================================================
// STEP 6: DOCKER & COMPOSE ASSETS
// ============================================================================
console.log('\n--- Step 6: Copying Docker & Compose Release Files ---');
fs.copyFileSync(path.join(ROOT_DIR, 'Dockerfile'), path.join(RELEASE_DIR, 'Dockerfile'));
fs.copyFileSync(path.join(ROOT_DIR, 'docker-compose.yml'), path.join(RELEASE_DIR, 'docker-compose.yml'));
fs.copyFileSync(path.join(ROOT_DIR, 'deploy', 'DOCKER_DEPLOYMENT.md'), path.join(RELEASE_DIR, 'DOCKER_DEPLOYMENT.md'));

// ============================================================================
// STEP 7: SHA-256 CHECKSUMS
// ============================================================================
console.log('\n--- Step 7: Generating SHA-256 Checksums ---');
const releaseFiles = [
  `prusalapse-v${VERSION}-windows-x64.zip`,
  `prusalapse-v${VERSION}-linux-x64.tar.gz`,
  `prusalapse-v${VERSION}-server-standalone.zip`,
  `prusalapse-v${VERSION}-firmware.zip`,
  'Dockerfile',
  'docker-compose.yml'
];

let checksumsText = `# PrusaLapse v${VERSION} Release Checksums (SHA-256)\n# Generated: ${new Date().toISOString()}\n\n`;

releaseFiles.forEach((file) => {
  const fullPath = path.join(RELEASE_DIR, file);
  if (fs.existsSync(fullPath)) {
    const hash = computeSha256(fullPath);
    checksumsText += `${hash}  ${file}\n`;
    console.log(`  ${hash.slice(0, 16)}...  ${file}`);
  }
});

fs.writeFileSync(path.join(RELEASE_DIR, 'CHECKSUMS.txt'), checksumsText);
console.log('✓ Generated: CHECKSUMS.txt');

// ============================================================================
// STEP 8: RELEASE NOTES
// ============================================================================
console.log('\n--- Step 8: Generating Release Notes ---');
const releaseNotes = `# PrusaLapse v${VERSION} Release

**Cinematic Multi-Camera Timelapses for Prusa 3D Printers (MK4 / MK3.9 / MINI / Core One / XL)**

---

## What's New in v${VERSION}

### 1. Portable Desktop Applications (Zero Install)
* **Windows (64-bit)**: \`prusalapse-v${VERSION}-windows-x64.zip\`
  * Fully self-contained desktop package featuring an embedded **Node.js 20 LTS** runtime, bundled **FFmpeg**, and a native **\`PrusaLapse.exe\`** launcher with custom branding.
  * Zero prerequisites: Does **not** require Node.js, Git, or npm installed on the computer. Simply extract and double-click to run!
* **Linux (x86_64)**: \`prusalapse-v${VERSION}-linux-x64.tar.gz\`
  * Self-contained distribution with embedded Linux Node.js runtime and an executable launcher script (\`./prusalapse\`).
  * Includes \`.desktop\` file for seamless desktop application menu integration on Ubuntu, Debian, Fedora, Arch, etc.

### 2. Universal Server & Container Deployment
* **Docker & Docker Compose**:
  * Multi-stage Alpine container image with built-in FFmpeg, curl, and non-root execution.
  * \`docker-compose.yml\` with persistent volume mappings for timelapse captures and camera configuration.
  * Ready for 1-click deployment on **CasaOS**, **TrueNAS SCALE**, **Unraid**, **Portainer**, and standard VPS.
* **Server Standalone Package**: \`prusalapse-v${VERSION}-server-standalone.zip\`
  * Minified Next.js standalone build that boots in <50ms with \`node server.js\`.
  * Includes Linux \`systemd\` service unit for headless Raspberry Pi / home server background execution.

### 3. Firmware v1.3.0 (ESP32-CAM)
* **High-Speed Paced Polling (400ms – 550ms)**: Eliminates the polling race condition across multiple cameras, guaranteeing 100% layer trigger detection inside parked G-code dwell windows (\`M220 S99\`).
* **Nextruder MBL Probing Guard**: Suppresses false trigger bursts during the MK4/MK3.9 170°C load-cell bed leveling routine.
* **Smart Z Drop Filtering**: Downward toolhead moves re-lock baseline without triggering false duplicate frames.
* **Automated USB Flasher**: Includes \`flash-firmware-windows.bat\` and \`flash-firmware-linux.sh\` with automated serial port detection for 1-click flashing.

---

## Release Assets
| Package | Description | Platform |
| :--- | :--- | :--- |
| **\`prusalapse-v${VERSION}-windows-x64.zip\`** | Portable Desktop App (Zero-install) | Windows 10/11 x64 |
| **\`prusalapse-v${VERSION}-linux-x64.tar.gz\`** | Portable Desktop App (Zero-install) | Linux x86_64 |
| **\`prusalapse-v${VERSION}-server-standalone.zip\`** | Standalone Node.js server bundle | Any Node.js host |
| **\`prusalapse-v${VERSION}-firmware.zip\`** | ESP32-CAM firmware & flasher scripts | ESP32-CAM |
| **\`Dockerfile\`** | Production multi-stage Alpine Dockerfile | Containers |
| **\`docker-compose.yml\`** | 1-click Docker Compose launcher | Containers |
| **\`CHECKSUMS.txt\`** | SHA-256 verification hashes | All |
`;

fs.writeFileSync(path.join(RELEASE_DIR, 'RELEASE_NOTES.md'), releaseNotes);
console.log('✓ Generated: RELEASE_NOTES.md');

console.log('\n================================================================');
console.log(`[SUCCESS] All v${VERSION} release artifacts built and packaged in:`);
console.log(`          ${RELEASE_DIR}`);
console.log('================================================================\n');
