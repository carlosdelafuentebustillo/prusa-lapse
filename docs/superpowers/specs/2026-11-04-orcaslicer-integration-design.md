# Design: OrcaSlicer Native Integration & Seamless Timelapse Auto-Injection

**Date:** 2026-11-04  
**Author:** Antigravity & User  
**Status:** Approved by Builder Check (Ready for Review)

---

## 1. Intent & Why
OrcaSlicer is rapidly becoming a primary slicer for Prusa MK4/MK3.9/XL/MINI users due to its advanced calibration tools, modern UI, and multi-bed/multi-plate workflows. Currently, creating parked multi-camera timelapses with PrusaLapse requires users to manually copy-paste custom G-code snippets into OrcaSlicer's **Printer Settings -> Custom G-code -> After layer change G-code**. This is error-prone, cumbersome to maintain across multiple printer profiles, and detached from the PrusaLapse dashboard.

With OrcaSlicer 2.5.0+, OrcaSlicer introduced an embedded Python plugin ecosystem with two native capability types:
1. **Page Plugins (`PagesPluginCapabilityBase`)**: Allows embedding custom HTML/JavaScript tabs directly in OrcaSlicer's top navigation bar via `wxWebView`.
2. **Slicing Pipeline Plugins (`SlicingPipelineCapabilityBase` with `psGCodePostProcess`)**: Hooks directly into the slicing pipeline to inspect and modify generated G-code in-place before export or network upload.

The intent of this project is to provide a seamless, native OrcaSlicer integration for PrusaLapse:
- Embed the full PrusaLapse dashboard (dual-camera feeds, print status, render gallery) directly inside OrcaSlicer.
- Introduce an **Automatic Slicing Injection** engine that automatically calculates and inserts toolhead parking, Z-hop lift, relative extrusion locking (`M83`), and `M220 S99` camera trigger dwell into every layer change right after slicing.
- Provide a simple, prominent disable toggle so users can effortlessly switch between cinematic timelapses and standard high-speed prints without toolhead parking.

---

## 2. Goals, Non-Goals & Anti-Goals

### Goals
* **Embedded Top-Level Tab**: Register a dedicated `PrusaLapse` tab in OrcaSlicer next to *Prepare*, *Preview*, and *Device*, rendering the full live dashboard without leaving the slicer.
* **Seamless G-Code Auto-Injection**: When enabled, the plugin automatically modifies sliced G-code during `psGCodePostProcess` to insert the toolhead parking routine and `M220 S99` camera trigger at every layer boundary. Zero manual G-code snippet pasting required.
* **Effortless Enable/Disable Switch**: Users can toggle automatic injection on/off with one click from both the embedded dashboard and the plugin configuration.
* **Dynamic Bed Geometry Clamping**: Slicing hook inspects G-code header metadata (`; bed_shape` / `; printable_area`) and safely clamps parking coordinates to `(max_x - 10, max_y - 10)`, preventing out-of-bounds toolhead collisions on smaller beds like the Prusa MINI (180x180 mm).
* **1-Click Plugin Installer**: In PrusaLapse's Timelapse Setup panel, provide a 1-click button (and CLI helper) that automatically detects OrcaSlicer installation paths on Windows and Linux and registers the plugin.

### Non-Goals
* Re-implementing the video rendering, FFmpeg pipeline, or ESP32-CAM firmware (already stabilized in v1.3.0).
* Forking or modifying OrcaSlicer C++ source code (must use official OrcaSlicer Python plugin APIs).
* Supporting pre-2.5 OrcaSlicer versions with Page Plugins (older versions will continue using the standard custom G-code snippet).

### Anti-Goals
* Do **not** block or freeze OrcaSlicer's UI thread during slicing; all G-code parsing and network calls must run safely within the background slicing worker thread.
* Do **not** overwrite or corrupt existing user G-code macros or printer profile settings.
* Do **not** force timelapses on every print: if the user disables auto-injection, the G-code passes through 100% untouched.
* Do **not** bundle heavy native C-extension compilers or non-portable binary decoders: the plugin must remain a zero-dependency pure-Python package.

---

## 3. Constraints & Technical Boundaries
* **Platform Support**: Must operate seamlessly on Windows 10/11 and Linux (matching OrcaSlicer's primary desktop operating systems).
* **Network & Endpoint Reliability**: If PrusaLapse is not running or unreachable when slicing, the plugin must fail gracefully (log a warning and leave G-code untouched) rather than crashing OrcaSlicer or failing the slice.
* **Binary G-code (`.bgcode`) Handling**: Standard ASCII `.gcode` is modified in-place seamlessly. If a binary `.bgcode` file is detected by file signature or extension, the hook safely bypasses injection and emits a non-blocking notification instructing the user to disable binary G-code for automated injection, avoiding fragile native library bundling.
* **Permissions**: Uses OrcaSlicer's native Python permission model (loopback/local network communication and file modification for slicing G-code).

---

## 4. Approaches Considered

### Approach A: Connected Slicer Plugin (Chosen)
* **Architecture**: The OrcaSlicer plugin is a lightweight, pure-Python package (<50 KB). The Page Plugin loads `http://127.0.0.1:3000` (or configured remote server IP) via `wxWebView`. The slicing hook queries the local/remote PrusaLapse REST API (`/api/config`) to fetch park parameters, validates bed safety boundaries, and performs in-place stream G-code injection.
* **Pros**:
  * Extremely lightweight (<50 KB plugin package).
  * Fast installation and zero dependency conflicts.
  * Single source of truth: dashboard, cameras, captures, and settings are shared across OrcaSlicer, desktop app, web browser, and mobile phone.
* **Cons**:
  * Requires PrusaLapse to be running while slicing.
* **Why Chosen**: The user explicitly selected Option A. It avoids duplicate 250MB runtimes and aligns with modern slicer-device integrations (like Fluidd/Mainsail in OrcaSlicer's Device tab).

### Approach B: Self-Contained Embedded Plugin
* **Architecture**: The OrcaSlicer plugin bundles its own dedicated Node.js runtime, standalone webapp, and FFmpeg binary directly inside OrcaSlicer's user plugin directory, spawning the server as a subprocess when OrcaSlicer starts.
* **Pros**: Completely self-contained within OrcaSlicer.
* **Cons**: Massive disk footprint (~350 MB per plugin install), slows down OrcaSlicer startup, only captures timelapses while OrcaSlicer is actively open on that PC, and cannot be monitored from another computer or phone.

---

## 5. System Architecture & Components

```
┌─────────────────────────────────────────────────────────────┐
│                        OrcaSlicer                           │
│                                                             │
│  ┌───────────────────────┐       ┌───────────────────────┐  │
│  │     Page Plugin       │       │ Slicing Pipeline Hook │  │
│  │   "PrusaLapse" Tab    │       │  (psGCodePostProcess) │  │
│  └───────────┬───────────┘       └───────────┬───────────┘  │
└──────────────┼───────────────────────────────┼──────────────┘
               │ (Embedded wxWebView)          │ (REST API Fetch &
               │                               │  G-Code In-Place Patch)
               ▼                               ▼
┌─────────────────────────────────────────────────────────────┐
│              PrusaLapse Application (v1.3.0)                │
│             (Local Desktop / Standalone / Docker)           │
│                                                             │
│  • REST API: /api/config, /api/slicer/status                │
│  • Web UI: Live Dual-Camera Streams, Render Queue, Gallery  │
│  • SlicerPanel: "OrcaSlicer Auto-Injection" Config & Install│
└─────────────────────────────────────────────────────────────┘
```

---

## 6. Implementation Details

### A. OrcaSlicer Python Plugin (`orcaslicer-plugin/prusalapse/`)

The plugin is structured according to OrcaSlicer 2.5 plugin conventions:
```
orcaslicer-plugin/
└── prusalapse/
    ├── __init__.py
    ├── plugin.py
    ├── config.json
    └── README.md
```

1. **Manifest & Permissions (`plugin.py`)**:
   - Decorated with `@orca.plugin`.
   - Declares permissions: network communication and filesystem read/write for temporary/output G-code files.
   - Registers two capabilities: `PrusaLapsePage` and `PrusaLapseSlicingHook`.

2. **Page Plugin (`PrusaLapsePage`)**:
   - Inherits from `orca.pages.PagesPluginCapabilityBase`.
   - `get_name()`: Returns `"PrusaLapse"`.
   - `get_ui()`: Injects an HTML/JS wrapper with a responsive `<iframe>` pointing to the configured PrusaLapse host (default: `http://127.0.0.1:3000`).
   - Uses `window.orca.postMessage({ type: 'save_config', host: '...' })` to let users update and persist the target server URL into the local `config.json` directly from the webview.

3. **Slicing Pipeline Capability (`PrusaLapseSlicingHook`)**:
   - Inherits from `orca.slicing.SlicingPipelineCapabilityBase`.
   - Filters on `ctx.step == orca.slicing.Step.psGCodePostProcess`.
   - Reads the G-code file path from `ctx.gcode_path`.
   - **Configuration Precedence**: Reads local `config.json` first (for slicer-level `enabled: true/false` override). If enabled, queries `GET http://127.0.0.1:3000/api/config` for the active park parameters.
   - If disabled or if PrusaLapse is unreachable, logs a clean non-blocking notification and returns `orca.ExecutionResult.success()` without altering the G-code.
   - **Binary Format Guard**: If the file starts with the binary `.bgcode` header (`0x47 0x43 0x44 0x45`), skips injection with a non-blocking message.
   - **Bed Clamping Safety**:
     - Scans header for `; bed_shape = ...` or `; printable_area = ...`.
     - Derives maximum $X$ and $Y$ limits.
     - Sets safe park target:
       $$\text{targetX} = \min(\text{parkX}, \text{bedMaxX} - 10)$$
       $$\text{targetY} = \min(\text{parkY}, \text{bedMaxY} - 10)$$
     - Prevents toolhead collisions on Prusa MINI (180x180 mm) and Prusa XL (360x360 mm).
   - **Layer Change Stream Injection**:
     - Scans G-code line-by-line for layer markers (`;AFTER_LAYER_CHANGE` or `;LAYER_CHANGE`).
     - Injects the sequence:
       ```gcode
       ; --- PRUSA-LAPSE PARKED TIMELAPSE START ---
       G91 ; Relative positioning
       G1 Z0.4 F600 ; Z-hop lift
       G90 ; Absolute positioning
       M83 ; Strict relative extrusion lock
       G1 X{targetX} Y{targetY} F9000 ; Move to safe park position
       G4 P{settleTime} ; Settle delay
       M220 S99 ; Trigger camera capture via PrusaLink
       G4 P{captureTime} ; Dwell for multi-camera capture
       M220 S100 ; Restore normal 100% print speed
       ; --- PRUSA-LAPSE PARKED TIMELAPSE END ---
       ```
     - Writes out the modified G-code atomically.

---

### B. PrusaLapse WebApp & Configuration (`webapp/`)

1. **Configuration Schema (`prusa-lapse.config.json`)**:
   Add new fields under `slicer`:
   ```json
   {
     "slicer": {
       "autoInjectOrcaSlicer": true,
       "orcaSlicerHost": "http://127.0.0.1:3000",
       "parkX": 240.0,
       "parkY": 210.0,
       "zHopHeight": 0.4,
       "settleTime": 300,
       "captureTime": 1200
     }
   }
   ```

2. **Timelapse Setup UI Update (`webapp/app/components/SlicerPanel.js`)**:
   - Add a prominent **OrcaSlicer Integration** section:
     - **Auto-Injection Toggle**: On/Off switch with live status badge ("Auto-Injection Active" / "Disabled").
     - **Plugin Installation Status**: Detects whether the plugin is installed in OrcaSlicer's user plugin directory.
     - **1-Click "Install to OrcaSlicer" Button**: Automatically copies the plugin into `%APPDATA%\OrcaSlicer\plugins\prusalapse` on Windows or `~/.config/OrcaSlicer/plugins/prusalapse` on Linux.
     - **Manual Download Link**: For users running remote or containerized setups.

3. **Backend API Route (`webapp/app/api/slicer/route.js`)**:
   - `GET /api/slicer/status`: Checks if OrcaSlicer plugin directories exist on the host and returns installation status.
   - `POST /api/slicer/install`: Copies `orcaslicer-plugin/prusalapse` into the detected OrcaSlicer plugins folder.

---

## 7. What's Left to the Builder
* Specific regex and line-matching patterns for detecting OrcaSlicer layer markers (`[layer_num]`, `;AFTER_LAYER_CHANGE`, etc.) in standard `.gcode`.
* Handling edge cases in G-code where the print height is at the printer's maximum Z ceiling (preventing Z-hop from commanding a move past physical max Z).
* CSS styling of the "Install to OrcaSlicer" button and status badge in `SlicerPanel.js` to match the existing dark aesthetic.
