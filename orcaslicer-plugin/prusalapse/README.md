# PrusaLapse OrcaSlicer Native Plugin

The native OrcaSlicer Python plugin for PrusaLapse brings automated camera timelapse triggering, toolhead parking, and full dual-camera management directly into the OrcaSlicer interface.

---

## Capabilities

1. **Integrated Web UI (Page Plugin)**:
   - Embeds the full PrusaLapse management interface (live camera feeds, status, manual triggers, and render queue) inside a dedicated **PrusaLapse** tab in OrcaSlicer.
   - Automatically synchronizes host settings via webview messaging (`window.orca.postMessage`).

2. **Automated Slicing Pipeline Hook (`psGCodePostProcess`)**:
   - Intercepts sliced G-code before export or printer upload.
   - Dynamically fetches the active parking coordinates and timing delays from the PrusaLapse server (`/api/config`).
   - If the PrusaLapse server is offline or unreachable, falls back gracefully to default parking parameters without interrupting slicing.
   - Injects the toolhead park, dwell delays, and `M220 S99` camera trigger at every layer change.
   - Clamps toolhead coordinates to safe bed boundaries (e.g. 180x180 mm on Prusa MINI, 250x210 mm on MK3/MK4, 360x360 mm on XL) to prevent mechanical crashes.
   - Protects against double injection and skips unsupported binary `.bgcode` files automatically.

---

## Installation

### Automated Installation (Recommended)
You can install the plugin with a single click from the **PrusaLapse Web UI** under **Slicer Integration -> OrcaSlicer -> Install Plugin**.

### Manual Installation
Copy the `prusalapse` plugin directory directly into the OrcaSlicer plugins folder for your operating system:

- **Windows**:
  ```powershell
  %APPDATA%\OrcaSlicer\plugins\prusalapse\
  ```
- **macOS**:
  ```bash
  ~/Library/Application Support/OrcaSlicer/plugins/prusalapse/
  ```
- **Linux**:
  ```bash
  ~/.config/OrcaSlicer/plugins/prusalapse/
  ```

Restart OrcaSlicer after copying the files.

---

## Directory Structure

```text
prusalapse/
├── __init__.py        # Package exports
├── plugin.py          # OrcaSlicer capability declarations & pipeline hook
├── injector.py        # Core G-code stream injector and bed boundary clamp
├── config.json        # Local plugin configuration
└── README.md          # Documentation
```

---

## Configuration (`config.json`)

The local configuration file resides in `prusalapse/config.json`:

```json
{
  "host": "http://127.0.0.1:3000",
  "enabled": true
}
```

- **`host`**: Base URL of your PrusaLapse instance (e.g. `http://192.168.1.100:3000` or `http://127.0.0.1:3000`).
- **`enabled`**: Master toggle. If set to `false`, the plugin will skip G-code modification entirely.

---

## Troubleshooting

- **Binary `.bgcode` files**: Binary G-code is not plain text. If OrcaSlicer exports in `.bgcode` format, the plugin safely skips injection. For parked timelapses, ensure ASCII G-code output is selected in your printer profile.
- **PrusaLapse server offline**: If slicing occurs while PrusaLapse is not running, the plugin automatically falls back to default parking coordinates (`X=240, Y=200`, `300ms` settle delay, `1200ms` dwell) and continues seamlessly.
