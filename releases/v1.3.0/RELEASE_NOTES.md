# PrusaLapse v1.3.0 Release

**Cinematic Multi-Camera Timelapses for Prusa 3D Printers (MK4 / MK3.9 / MINI / Core One / XL)**

---

## What's New in v1.3.0

### 1. Dedicated Desktop Applications (Windows & Linux)
* **Windows Installer (`PrusaLapse-Setup-1.3.0.exe`)**:
  * Professional NSIS installation wizard with customizable install directory.
  * Creates Start Menu and Desktop shortcuts, plus clean uninstaller in Windows Settings / Add & Remove Programs.
  * Dedicated native window with dark UI theme (`#121417`), auto-hidden menubar, bundled FFmpeg, and seamless system integration.
* **Windows Portable Desktop App (`PrusaLapse-1.3.0-portable.exe`)**:
  * 100% portable, single-file native desktop executable.
  * Zero prerequisites: Does **not** require Node.js, Git, or administrative privileges. Simply download, double-click, and run anywhere (e.g. USB flash drive).
* **Linux Desktop App (`PrusaLapse-1.3.0-linux-x64.tar.gz`)**:
  * Dedicated native Electron desktop window for Linux (Ubuntu, Debian, Fedora, Arch, etc.).
  * Extract and run `./prusalapse-desktop` with zero external Node.js dependencies.

### 2. Universal Server & Container Deployment
* **Docker & Docker Compose**:
  * Multi-stage Alpine container image with built-in FFmpeg, curl, and non-root execution.
  * `docker-compose.yml` with persistent volume mappings for timelapse captures and camera configuration.
  * Ready for 1-click deployment on **CasaOS**, **TrueNAS SCALE**, **Unraid**, **Portainer**, and standard VPS.
* **Server Standalone Package (`prusalapse-v1.3.0-server-standalone.zip`)**:
  * Minified Next.js standalone build that boots in <50ms with `node server.js`.
  * Includes Linux `systemd` service unit (`prusalapse.service`) for headless Raspberry Pi / home server background execution.

### 3. Firmware v1.3.0 (ESP32-CAM)
* **High-Speed Paced Polling (400ms – 550ms)**: Eliminates the polling race condition across multiple cameras, guaranteeing 100% layer trigger detection inside parked G-code dwell windows (`M220 S99`).
* **Nextruder MBL Probing Guard**: Suppresses false trigger bursts during the MK4/MK3.9 170°C load-cell bed leveling routine.
* **Smart Z Drop Filtering**: Downward toolhead moves re-lock baseline without triggering false duplicate frames.
* **Automated USB Flasher**: Includes `flash-firmware-windows.bat` and `flash-firmware-linux.sh` with automated serial port detection for 1-click flashing.

### 4. OrcaSlicer 2.5+ Native Plugin Integration
* **Automated G-Code Injection Hook (`psGCodePostProcess`)**:
  * Seamlessly injects toolhead parking moves, settling delays, and camera capture triggers (`M220 S99`) during slicing without external post-processing scripts.
  * Dynamically queries the PrusaLapse server (`/api/config`) for parking coordinates and timing, with built-in offline fallback defaults.
  * Dynamic bed boundary clamping ensures parking stays strictly within physical limits across Prusa MK4, MK3.9, MINI, and XL printers.
  * Relative extrusion protection (`M83`) and binary `.bgcode` bypass safety guards.
* **Integrated Web UI Tab (Page Plugin)**:
  * Embeds the full PrusaLapse dashboard, live multi-camera feeds, and render queue directly into a dedicated OrcaSlicer tab.
* **1-Click Web UI & Manual Installation**:
  * 1-Click installer right inside the PrusaLapse Slicer panel, or manual drop-in via `prusalapse-orcaslicer-plugin.zip`.

---

## Release Assets & Verification

| Package | Type | Platform | Description |
| :--- | :--- | :--- | :--- |
| **`PrusaLapse-Setup-1.3.0.exe`** | Desktop Installer | Windows 10/11 x64 | Full installer wizard with desktop & start menu shortcuts |
| **`PrusaLapse-1.3.0-portable.exe`** | Portable Desktop | Windows 10/11 x64 | Single-file zero-install dedicated desktop app |
| **`PrusaLapse-1.3.0-linux-x64.tar.gz`** | Portable Desktop | Linux x86_64 | Dedicated native desktop app for Linux distributions |
| **`prusalapse-v1.3.0-server-standalone.zip`** | Web App / Server | Any Node.js host | Headless server bundle with systemd service unit |
| **`prusalapse-v1.3.0-firmware.zip`** | Firmware & Tooling | ESP32-CAM | Firmware v1.3.0 binaries & 1-click serial flasher scripts |
| **`prusalapse-orcaslicer-plugin.zip`** | Slicer Plugin | OrcaSlicer 2.5+ (All OS) | Native OrcaSlicer plugin with auto-injection & live tab |
| **`Dockerfile`** | Container | Docker / Podman | Production multi-stage Alpine Dockerfile |
| **`docker-compose.yml`** | Orchestration | Docker Compose | 1-click stack for CasaOS, Unraid, TrueNAS, VPS |
| **`CHECKSUMS.txt`** | Verification | All | Cryptographic SHA-256 hashes for all release artifacts |
