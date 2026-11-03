# Portable Desktop App & Universal Server Release (v1.3.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, package, and verify a complete v1.3.0 release featuring self-contained portable desktop applications for Windows and Linux (zero dependencies / no Node.js required), production Docker/container deployment with persistent storage, a standalone server bundle for generic hosts, and compiled ESP32-CAM firmware with automated flash utilities.

**Architecture:** Configure Next.js for standalone tracing (`output: 'standalone'`). Decouple filesystem and FFmpeg/curl paths in `webapp/lib/` and API routes to support dynamic environment overrides (`FFMPEG_PATH`, `PRUSALAPSE_CONFIG_FILE`, `PRUSALAPSE_CAPTURES_DIR`, platform-aware curl). Create native Windows (`PrusaLapse.exe` via C# / .NET `csc.exe`) and Linux launcher binaries with embedded portable Node.js runtimes and bundled binaries. Provide multi-stage Alpine Dockerfile and docker-compose configurations for container platforms (CasaOS, Unraid, TrueNAS, VPS), and automate packaging with checksum verification.

**Tech Stack:** Next.js 16 (App Router), Node.js 20 LTS standalone runner, C# / .NET Framework `csc.exe` launcher, Bash, Docker (multi-stage Alpine), PlatformIO (ESP32-CAM C++ firmware v1.3.0), FFmpeg, curl.

**Spec:** Unified release specification for portable desktop and server deployment.

## Global Constraints
* Portable Windows and Linux distributions MUST run out-of-the-box without requiring Node.js, npm, or dev tools pre-installed on the host system.
* Server Docker containers MUST run unprivileged and persist captures/config across container updates via mounted volumes.
* Firmware MUST be compiled via PlatformIO, bumped to `v1.3.0` in `firmware/src/main.cpp`, and webapp bumped to `0.2.11` (or `1.3.0`) in `webapp/package.json`.
* RULE[user_global]: NEVER run `git push` without explicit user confirmation.

## Review Focus
1. Portable Windows app launches successfully from its folder via `PrusaLapse.exe` and `PrusaLapse.bat`, finding the bundled `runtime/node.exe` and `bin/ffmpeg.exe`.
2. Portable Linux app launcher script properly detects bundled `runtime/bin/node` and system/bundled `ffmpeg`, with proper permissions and desktop integration.
3. Next.js standalone build properly serves both dynamic API routes and static assets (`/_next/static/` and `/captures/`).
4. Dockerfile builds cleanly on Docker/Podman environments and runs as non-root user with persistent volumes on `/app/public/captures` and `/app/config`.
5. Firmware compiles cleanly, matches version `v1.3.0`, and flashing utilities provide automated COM/tty detection.

---

### Task 1: Environment Agnostic Runtime Refactoring in Webapp

**Files:**
- Modify: `webapp/lib/monitor.js:10-50, 1675-1760`
- Modify: `webapp/app/api/camera/update/route.js:120-135`
- Modify: `webapp/next.config.mjs`

- [ ] **Step 1: Update `getFFmpegPath()` and storage paths in `webapp/lib/monitor.js`**
  Support `FFMPEG_PATH`, portable `bin/` directory, `@ffmpeg-installer`, and system PATH fallback. Support `PRUSALAPSE_CONFIG_FILE` and `PRUSALAPSE_CAPTURES_DIR` for flexible server/Docker volume mounting.
- [ ] **Step 2: Make `update/route.js` cross-platform for curl execution**
  Detect `process.platform === 'win32' ? 'curl.exe' : 'curl'` and check local `bin/` fallback so OTA flashing works identically on Windows, Linux, and Docker.
- [ ] **Step 3: Ensure Next.js standalone config is locked in `next.config.mjs`**
  Verify `output: 'standalone'` and ensure proper asset tracing.
- [ ] **Step 4: Verify webapp builds and runs standalone**
  Run `npm run build --prefix webapp` and verify `.next/standalone/server.js` functions.

---

### Task 2: Build ESP32-CAM Firmware v1.3.0 and Flashing Utilities

**Files:**
- Modify: `firmware/src/main.cpp:20-30`
- Create: `deploy/firmware/flash-firmware-windows.bat`
- Create: `deploy/firmware/flash-firmware-linux.sh`
- Create: `deploy/firmware/README.md`

- [ ] **Step 1: Bump firmware version to `v1.3.0` in `firmware/src/main.cpp`**
- [ ] **Step 2: Compile firmware via PlatformIO**
  Execute `pio run -d firmware` and verify `.pio/build/esp32cam/firmware.bin`.
- [ ] **Step 3: Sync `firmware.bin` to `webapp/public/firmware.bin`**
- [ ] **Step 4: Create automated USB flashing scripts (`esptool.py` wrappers)**
  Create `flash-firmware-windows.bat` and `flash-firmware-linux.sh` with interactive COM port selection and baud rate configuration (460800 baud).

---

### Task 3: Docker & Server Deployment Artifacts

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.dockerignore`
- Create: `deploy/systemd/prusalapse.service`
- Create: `deploy/DOCKER_DEPLOYMENT.md`

- [ ] **Step 1: Create multi-stage production `Dockerfile`**
  - Base: `node:20-alpine`.
  - Stage 1: Build standalone Next.js application.
  - Stage 2: Runtime image installing `ffmpeg` and `curl`, non-root user `nextjs`, exposing port 3000, volume mount points.
- [ ] **Step 2: Create `docker-compose.yml`**
  Configure persistent volumes for `./captures:/app/public/captures` and `./config:/app/config`, healthchecks, and environment defaults.
- [ ] **Step 3: Create `.dockerignore`**
  Exclude `.git`, `node_modules`, `firmware/.pio`, `captures`, `.next/cache`.
- [ ] **Step 4: Create Linux systemd service unit (`prusalapse.service`)**
  Enable running on headless Raspberry Pi or Ubuntu servers.
- [ ] **Step 5: Document deployment options in `deploy/DOCKER_DEPLOYMENT.md`**
  Clear guides for CasaOS, Unraid, TrueNAS, Portainer, and standard VPS.

---

### Task 4: Windows Portable Desktop Packaging

**Files:**
- Create: `deploy/windows/launcher.cs`
- Create: `deploy/windows/PrusaLapse.bat`
- Create: `deploy/windows/README.md`
- Script: `scripts/build-portable-windows.js`

- [ ] **Step 1: Write native Windows C# Launcher (`deploy/windows/launcher.cs`)**
  - Features: Looks for `runtime\node.exe`, sets `PORT=3000`, `HOSTNAME=0.0.0.0`, launches `app\server.js`, and automatically opens the user's default browser to `http://localhost:3000`.
  - Compiles with built-in `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe` into `PrusaLapse.exe` embedding `prusalapse.ico`.
- [ ] **Step 2: Create fallback console launcher `PrusaLapse.bat`**
- [ ] **Step 3: Download and isolate Node.js v20 Win-x64 portable binary (`runtime/node.exe`)**
- [ ] **Step 4: Bundle `ffmpeg.exe` and `curl.exe` in `bin/`**
- [ ] **Step 5: Assemble `prusalapse-v1.3.0-windows-x64.zip`**
  Assemble directory and create zip archive.

---

### Task 5: Linux Portable Desktop Packaging

**Files:**
- Create: `deploy/linux/prusalapse` (executable script)
- Create: `deploy/linux/prusalapse.desktop`
- Create: `deploy/linux/README.md`
- Script: `scripts/build-portable-linux.js`

- [ ] **Step 1: Create Linux executable launcher script (`deploy/linux/prusalapse`)**
  - Features: Resolves script directory, checks `runtime/bin/node`, sets `PORT=3000`, launches `app/server.js`, and calls `xdg-open http://localhost:3000`.
- [ ] **Step 2: Create Linux Desktop entry (`deploy/linux/prusalapse.desktop`)**
  Provides icon and app launcher integration on GNOME/KDE/XFCE.
- [ ] **Step 3: Download and isolate Node.js v20 Linux-x64 portable binary (`runtime/bin/node`)**
- [ ] **Step 4: Assemble `prusalapse-v1.3.0-linux-x64.tar.gz`**
  Assemble directory with execution permissions preserved (`chmod +x`).

---

### Task 6: Master Release Automation Pipeline & Verification

**Files:**
- Modify: `webapp/package.json:2-3`
- Create: `scripts/build-all-releases.js`
- Create: `releases/v1.3.0/RELEASE_NOTES.md`
- Generate: `releases/v1.3.0/CHECKSUMS.txt`

- [ ] **Step 1: Bump webapp version to `1.3.0` in `webapp/package.json`**
- [ ] **Step 2: Implement master release script `scripts/build-all-releases.js`**
  Orchestrates:
  1. Compiling firmware v1.3.0.
  2. Building Next.js standalone application.
  3. Generating Windows portable zip.
  4. Generating Linux portable tar.gz.
  5. Generating Server standalone zip.
  6. Generating Firmware flash bundle.
  7. Computing SHA256 checksums into `CHECKSUMS.txt`.
- [ ] **Step 3: Execute master release build and verify all assets**
  Run `node scripts/build-all-releases.js` and verify output packages.
- [ ] **Step 4: Test Windows portable launch and server launch**
  Verify the packaged portable apps start, listen on port 3000, and serve the dashboard.
- [ ] **Step 5: Commit changes locally**
  Stage and commit all release files. Do NOT push without user permission.
