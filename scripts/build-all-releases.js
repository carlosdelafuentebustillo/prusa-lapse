const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');
const AdmZip = require('../webapp/node_modules/adm-zip');

const VERSION = '1.3.0';
const ROOT_DIR = path.resolve(__dirname, '..');
const RELEASE_DIR = path.join(ROOT_DIR, 'releases', `v${VERSION}`);
const STAGING_DIR = path.join(ROOT_DIR, 'dist', 'staging');
const DESKTOP_DIR = path.join(ROOT_DIR, 'desktop');
const DESKTOP_DIST_DIR = path.join(DESKTOP_DIR, 'dist');

console.log('================================================================');
console.log(`        PRUSALAPSE MASTER RELEASE BUILD PIPELINE (v${VERSION})   `);
console.log('================================================================');
console.log(`Root Directory:    ${ROOT_DIR}`);
console.log(`Release Directory: ${RELEASE_DIR}`);
console.log();

// Ensure clean directories
[RELEASE_DIR, STAGING_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Helper: Compute SHA-256 checksum
function computeSha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
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

// Sync firmware.bin to webapp public for OTA updates
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
const standaloneServerJs = path.join(ROOT_DIR, 'webapp', '.next', 'standalone', 'server.js');
if (!fs.existsSync(standaloneServerJs) || process.argv.includes('--rebuild-webapp')) {
  execSync('npm run build', { cwd: path.join(ROOT_DIR, 'webapp'), stdio: 'inherit' });
} else {
  console.log('  [CACHE HIT] webapp/.next/standalone/server.js exists. (Pass --rebuild-webapp to force rebuild)');
}

const standaloneDir = path.join(ROOT_DIR, 'webapp', '.next', 'standalone');
const nextStaticSrc = path.join(ROOT_DIR, 'webapp', '.next', 'static');
const nextStaticDest = path.join(standaloneDir, '.next', 'static');
const publicSrc = path.join(ROOT_DIR, 'webapp', 'public');
const publicDest = path.join(standaloneDir, 'public');

// Copy static assets into standalone bundle
if (!fs.existsSync(nextStaticDest)) {
  console.log('  Copying static assets into standalone bundle...');
  execSync(`powershell -NoProfile -Command "Copy-Item -Path '${nextStaticSrc}' -Destination '${nextStaticDest}' -Recurse -Force"`);
}
if (!fs.existsSync(publicDest)) {
  execSync(`powershell -NoProfile -Command "Copy-Item -Path '${publicSrc}' -Destination '${publicDest}' -Recurse -Force"`);
}

// ============================================================================
// STEP 3: SERVER STANDALONE PACKAGE (ZIP)
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
// STEP 4: DESKTOP APPLICATION PACKAGING (Windows & Linux Electron)
// ============================================================================
console.log('\n--- Step 4: Staging & Packaging Desktop Applications ---');

// 1. Stage standalone files and binaries into desktop/
execSync('node stage-desktop.js', { cwd: DESKTOP_DIR, stdio: 'inherit' });

// 2. Check if desktop binaries need to be built
const winInstaller = path.join(DESKTOP_DIST_DIR, `PrusaLapse-Setup-${VERSION}.exe`);
const winPortable = path.join(DESKTOP_DIST_DIR, `PrusaLapse-${VERSION}-portable.exe`);
const linuxPortable = path.join(DESKTOP_DIST_DIR, `PrusaLapse-${VERSION}-linux-x64.tar.gz`);

const needWinBuild = !fs.existsSync(winInstaller) || !fs.existsSync(winPortable) || process.argv.includes('--rebuild-desktop');
const needLinuxBuild = !fs.existsSync(linuxPortable) || process.argv.includes('--rebuild-desktop');

if (needWinBuild) {
  console.log('  Building Windows Desktop (Installer & Portable) with Electron Builder...');
  execSync('npm run build:win', { cwd: DESKTOP_DIR, stdio: 'inherit' });
} else {
  console.log('  [CACHE HIT] Windows Desktop binaries exist in desktop/dist.');
}

if (needLinuxBuild) {
  console.log('  Building Linux Desktop bundle with Electron Builder...');
  execSync('npm run build:linux', { cwd: DESKTOP_DIR, stdio: 'inherit' });
} else {
  console.log('  [CACHE HIT] Linux Desktop tar.gz exists in desktop/dist.');
}

// 3. Copy desktop binaries to releases directory
console.log('  Copying desktop distribution assets to release folder...');
fs.copyFileSync(winInstaller, path.join(RELEASE_DIR, `PrusaLapse-Setup-${VERSION}.exe`));
fs.copyFileSync(winPortable, path.join(RELEASE_DIR, `PrusaLapse-${VERSION}-portable.exe`));
fs.copyFileSync(linuxPortable, path.join(RELEASE_DIR, `PrusaLapse-${VERSION}-linux-x64.tar.gz`));

console.log(`✓ Copied: PrusaLapse-Setup-${VERSION}.exe (${(fs.statSync(winInstaller).size / 1024 / 1024).toFixed(1)} MB)`);
console.log(`✓ Copied: PrusaLapse-${VERSION}-portable.exe (${(fs.statSync(winPortable).size / 1024 / 1024).toFixed(1)} MB)`);
console.log(`✓ Copied: PrusaLapse-${VERSION}-linux-x64.tar.gz (${(fs.statSync(linuxPortable).size / 1024 / 1024).toFixed(1)} MB)`);

// Clean up legacy non-electron zips if present
const legacyWinZip = path.join(RELEASE_DIR, `prusalapse-v${VERSION}-windows-x64.zip`);
const legacyLinuxTar = path.join(RELEASE_DIR, `prusalapse-v${VERSION}-linux-x64.tar.gz`);
if (fs.existsSync(legacyWinZip)) fs.rmSync(legacyWinZip);
if (fs.existsSync(legacyLinuxTar)) fs.rmSync(legacyLinuxTar);

// ============================================================================
// STEP 5: DOCKER & SERVER DEPLOYMENT ASSETS
// ============================================================================
console.log('\n--- Step 5: Copying Docker & Compose Release Files ---');
fs.copyFileSync(path.join(ROOT_DIR, 'Dockerfile'), path.join(RELEASE_DIR, 'Dockerfile'));
fs.copyFileSync(path.join(ROOT_DIR, 'docker-compose.yml'), path.join(RELEASE_DIR, 'docker-compose.yml'));
fs.copyFileSync(path.join(ROOT_DIR, 'deploy', 'DOCKER_DEPLOYMENT.md'), path.join(RELEASE_DIR, 'DOCKER_DEPLOYMENT.md'));
console.log('✓ Copied Dockerfile, docker-compose.yml, and DOCKER_DEPLOYMENT.md');

// ============================================================================
// STEP 6: ORCASLICER NATIVE PLUGIN PACKAGE (ZIP)
// ============================================================================
console.log('\n--- Step 6: Packaging OrcaSlicer Native Plugin ---');
const orcaPluginDir = path.join(ROOT_DIR, 'orcaslicer-plugin', 'prusalapse');
const orcaZipPath = path.join(RELEASE_DIR, 'prusalapse-orcaslicer-plugin.zip');
const orcaZip = new AdmZip();

function addPluginFilesRecursively(dir, zipSubDir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '__pycache__' || entry.name.endsWith('.pyc') || entry.name === 'injector.py' || entry.name === '__init__.py') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      addPluginFilesRecursively(fullPath, path.posix.join(zipSubDir, entry.name));
    } else if (entry.isFile()) {
      orcaZip.addLocalFile(fullPath, zipSubDir);
    }
  }
}

addPluginFilesRecursively(orcaPluginDir, 'prusalapse');
orcaZip.writeZip(orcaZipPath);
console.log(`✓ Created: ${path.basename(orcaZipPath)} (${(fs.statSync(orcaZipPath).size / 1024).toFixed(1)} KB)`);

// ============================================================================
// STEP 7: SHA-256 CHECKSUMS
// ============================================================================
console.log('\n--- Step 7: Generating SHA-256 Checksums ---');
const releaseFiles = [
  `PrusaLapse-Setup-${VERSION}.exe`,
  `PrusaLapse-${VERSION}-portable.exe`,
  `PrusaLapse-${VERSION}-linux-x64.tar.gz`,
  `prusalapse-v${VERSION}-server-standalone.zip`,
  `prusalapse-v${VERSION}-firmware.zip`,
  'prusalapse-orcaslicer-plugin.zip',
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

### 1. Dedicated Desktop Applications (Windows & Linux)
* **Windows Installer (\`PrusaLapse-Setup-${VERSION}.exe\`)**:
  * Professional NSIS installation wizard with customizable install directory.
  * Creates Start Menu and Desktop shortcuts, plus clean uninstaller in Windows Settings / Add & Remove Programs.
  * Dedicated native window with dark UI theme (\`#121417\`), auto-hidden menubar, bundled FFmpeg, and seamless system integration.
* **Windows Portable Desktop App (\`PrusaLapse-${VERSION}-portable.exe\`)**:
  * 100% portable, single-file native desktop executable.
  * Zero prerequisites: Does **not** require Node.js, Git, or administrative privileges. Simply download, double-click, and run anywhere (e.g. USB flash drive).
* **Linux Desktop App (\`PrusaLapse-${VERSION}-linux-x64.tar.gz\`)**:
  * Dedicated native Electron desktop window for Linux (Ubuntu, Debian, Fedora, Arch, etc.).
  * Extract and run \`./prusalapse-desktop\` with zero external Node.js dependencies.

### 2. Universal Server & Container Deployment
* **Docker & Docker Compose**:
  * Multi-stage Alpine container image with built-in FFmpeg, curl, and non-root execution.
  * \`docker-compose.yml\` with persistent volume mappings for timelapse captures and camera configuration.
  * Ready for 1-click deployment on **CasaOS**, **TrueNAS SCALE**, **Unraid**, **Portainer**, and standard VPS.
* **Server Standalone Package (\`prusalapse-v${VERSION}-server-standalone.zip\`)**:
  * Minified Next.js standalone build that boots in <50ms with \`node server.js\`.
  * Includes Linux \`systemd\` service unit (\`prusalapse.service\`) for headless Raspberry Pi / home server background execution.

### 3. Firmware v1.3.0 (ESP32-CAM)
* **High-Speed Paced Polling (400ms – 550ms)**: Eliminates the polling race condition across multiple cameras, guaranteeing 100% layer trigger detection inside parked G-code dwell windows (\`M220 S99\`).
* **Nextruder MBL Probing Guard**: Suppresses false trigger bursts during the MK4/MK3.9 170°C load-cell bed leveling routine.
* **Smart Z Drop Filtering**: Downward toolhead moves re-lock baseline without triggering false duplicate frames.
* **Automated USB Flasher**: Includes \`flash-firmware-windows.bat\` and \`flash-firmware-linux.sh\` with automated serial port detection for 1-click flashing.

### 4. OrcaSlicer 2.5+ Native Plugin Integration
* **Automated G-Code Injection Hook (\`psGCodePostProcess\`)**:
  * Seamlessly injects toolhead parking moves, settling delays, and camera capture triggers (\`M220 S99\`) during slicing without external post-processing scripts.
  * Dynamically queries the PrusaLapse server (\`/api/config\`) for parking coordinates and timing, with built-in offline fallback defaults.
  * Dynamic bed boundary clamping ensures parking stays strictly within physical limits across Prusa MK4, MK3.9, MINI, and XL printers.
  * Relative extrusion protection (\`M83\`) and binary \`.bgcode\` bypass safety guards.
* **Integrated Web UI Tab (Page Plugin)**:
  * Embeds the full PrusaLapse dashboard, live multi-camera feeds, and render queue directly into a dedicated OrcaSlicer tab.
* **1-Click Web UI & Manual Installation**:
  * 1-Click installer right inside the PrusaLapse Slicer panel, or manual drop-in via \`prusalapse-orcaslicer-plugin.zip\`.

---

## Release Assets & Verification

| Package | Type | Platform | Description |
| :--- | :--- | :--- | :--- |
| **\`PrusaLapse-Setup-${VERSION}.exe\`** | Desktop Installer | Windows 10/11 x64 | Full installer wizard with desktop & start menu shortcuts |
| **\`PrusaLapse-${VERSION}-portable.exe\`** | Portable Desktop | Windows 10/11 x64 | Single-file zero-install dedicated desktop app |
| **\`PrusaLapse-${VERSION}-linux-x64.tar.gz\`** | Portable Desktop | Linux x86_64 | Dedicated native desktop app for Linux distributions |
| **\`prusalapse-v${VERSION}-server-standalone.zip\`** | Web App / Server | Any Node.js host | Headless server bundle with systemd service unit |
| **\`prusalapse-v${VERSION}-firmware.zip\`** | Firmware & Tooling | ESP32-CAM | Firmware v1.3.0 binaries & 1-click serial flasher scripts |
| **\`prusalapse-orcaslicer-plugin.zip\`** | Slicer Plugin | OrcaSlicer 2.5+ (All OS) | Native OrcaSlicer plugin with auto-injection & live tab |
| **\`Dockerfile\`** | Container | Docker / Podman | Production multi-stage Alpine Dockerfile |
| **\`docker-compose.yml\`** | Orchestration | Docker Compose | 1-click stack for CasaOS, Unraid, TrueNAS, VPS |
| **\`CHECKSUMS.txt\`** | Verification | All | Cryptographic SHA-256 hashes for all release artifacts |
`;

fs.writeFileSync(path.join(RELEASE_DIR, 'RELEASE_NOTES.md'), releaseNotes);
console.log('✓ Generated: RELEASE_NOTES.md');

console.log('\n================================================================');
console.log(`[SUCCESS] All v${VERSION} release artifacts built and packaged in:`);
console.log(`          ${RELEASE_DIR}`);
console.log('================================================================\n');
