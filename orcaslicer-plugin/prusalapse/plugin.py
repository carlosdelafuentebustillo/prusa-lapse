# /// script
# name = "prusalapse"
# version = "1.3.3"
# description = "Native PrusaLapse dual-camera timelapse integration for OrcaSlicer"
# authors = [{name = "PrusaLapse"}]
# requires-python = ">=3.10"
# dependencies = []
# [tool.orcaslicer.plugin]
# name = "prusalapse"
# version = "1.3.3"
# author = "PrusaLapse"
# description = "Native PrusaLapse dual-camera timelapse integration for OrcaSlicer"
# ///
"""
OrcaSlicer native plugin implementation for PrusaLapse.

Provides:
- Page Plugin (wxWebView iframe embedding the PrusaLapse web interface)
- Slicing Pipeline Hook (psGCodePostProcess in-place G-code injection)
- Safe bed boundary detection and corner parking
- Strict relative extrusion (M83) enforcement
- Local configuration management (config.json)
- Remote config synchronization via /api/config with graceful offline fallback
"""

from __future__ import annotations

import atexit
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from typing import Any

DEFAULT_CONFIG: dict[str, Any] = {
    "host": "http://127.0.0.1:3000",
    "enabled": True,
}

START_MARKER = "; --- PRUSA-LAPSE PARKED TIMELAPSE START ---"
END_MARKER = "; --- PRUSA-LAPSE PARKED TIMELAPSE END ---"

DEFAULT_BED_LIMITS = (250.0, 210.0)

_SERVER_PROCESS: subprocess.Popen | None = None


# ---------------------------------------------------------------------------
# Embedded Server Process Management
# ---------------------------------------------------------------------------

def is_server_alive(host: str = "http://127.0.0.1:3000", timeout: float = 0.5) -> bool:
    """Return True if the PrusaLapse HTTP server is active and responding."""
    url = f"{host.rstrip('/')}/api/config"
    try:
        req = urllib.request.Request(
            url, headers={"User-Agent": "OrcaSlicer-PrusaLapse-Probe"}
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status in (200, 304)
    except Exception:
        return False


def find_server_components() -> tuple[str | None, str | None, dict[str, str]]:
    """Locate the server executable runner, server.js script, and environment flags."""
    electron_win = r"C:\Program Files\PrusaLapse\PrusaLapse.exe"
    electron_app_js = r"C:\Program Files\PrusaLapse\resources\app\app\server.js"
    local_app_data = os.environ.get("LOCALAPPDATA", "")
    electron_local_win = os.path.join(
        local_app_data, "Programs", "PrusaLapse", "PrusaLapse.exe"
    )
    electron_local_js = os.path.join(
        local_app_data, "Programs", "PrusaLapse", "resources", "app", "app", "server.js"
    )

    script_candidates = [
        os.environ.get("PRUSALAPSE_SERVER_SCRIPT"),
        electron_app_js,
        electron_local_js,
        os.path.abspath(
            os.path.join(
                os.path.dirname(__file__),
                "..",
                "..",
                "webapp",
                ".next",
                "standalone",
                "server.js",
            )
        ),
        os.path.abspath(
            r"C:\Users\cafub\Documents\Antigravity\dual-dalmatian\webapp\.next\standalone\server.js"
        ),
    ]

    selected_script = None
    for cand in script_candidates:
        if cand and os.path.exists(cand):
            selected_script = cand
            break

    if not selected_script:
        return None, None, {}

    extra_env: dict[str, str] = {}
    if os.path.exists(electron_win):
        runner = electron_win
        extra_env["ELECTRON_RUN_AS_NODE"] = "1"
    elif os.path.exists(electron_local_win):
        runner = electron_local_win
        extra_env["ELECTRON_RUN_AS_NODE"] = "1"
    else:
        runner = shutil.which("node")

    if not runner:
        return None, None, {}

    # Detect bundled FFmpeg binary for server video compilation
    ffmpeg_candidates = [
        r"C:\Program Files\PrusaLapse\resources\app\bin\ffmpeg.exe",
        r"C:\Program Files\PrusaLapse\resources\bin\ffmpeg.exe",
        os.path.join(local_app_data, "Programs", "PrusaLapse", "resources", "app", "bin", "ffmpeg.exe"),
        shutil.which("ffmpeg"),
    ]
    for fc in ffmpeg_candidates:
        if fc and os.path.exists(fc):
            extra_env["FFMPEG_PATH"] = fc
            break

    # Direct writable config and captures to %APPDATA%\PrusaLapse
    appdata = os.environ.get("APPDATA")
    if appdata:
        pl_dir = os.path.join(appdata, "PrusaLapse")
        try:
            os.makedirs(pl_dir, exist_ok=True)
            target_cfg = os.path.join(pl_dir, "prusa-lapse.config.json")
            extra_env["PRUSALAPSE_CONFIG_FILE"] = target_cfg
            extra_env["PRUSALAPSE_CAPTURES_DIR"] = os.path.join(pl_dir, "captures")

            # Auto-seed configuration if target_cfg does not exist or is empty
            if not os.path.exists(target_cfg) or os.path.getsize(target_cfg) < 10:
                cfg_candidates = [
                    os.path.abspath(os.path.join(os.path.dirname(selected_script), "..", "..", "prusa-lapse.config.json")),
                    os.path.abspath(os.path.join(os.path.dirname(selected_script), "prusa-lapse.config.json")),
                    r"C:\Users\cafub\Documents\Antigravity\dual-dalmatian\webapp\prusa-lapse.config.json",
                    r"C:\Program Files\PrusaLapse\resources\app\app\prusa-lapse.config.json",
                    os.path.join(local_app_data, "Programs", "PrusaLapse", "resources", "app", "app", "prusa-lapse.config.json"),
                ]
                for cc in cfg_candidates:
                    if cc and os.path.exists(cc) and os.path.getsize(cc) > 10:
                        try:
                            shutil.copy2(cc, target_cfg)
                            break
                        except Exception:
                            pass
        except Exception:
            pass

    return runner, selected_script, extra_env


def ensure_server_running(host: str = "http://127.0.0.1:3000") -> bool:
    """
    Ensure the PrusaLapse server is running.
    If targeting localhost/127.0.0.1 and offline, spawns the server in the background.
    """
    global _SERVER_PROCESS

    # Only attempt to auto-spawn if host is local
    is_local = "127.0.0.1" in host or "localhost" in host
    if not is_local:
        return True

    if is_server_alive(host):
        return True

    if _SERVER_PROCESS is not None and _SERVER_PROCESS.poll() is None:
        return True

    runner, script, extra_env = find_server_components()
    if not runner or not script:
        return False

    port = "3000"
    m = re.search(r":(\d+)", host)
    if m:
        port = m.group(1)

    env = dict(os.environ)
    env.update(extra_env)
    env["PORT"] = port
    env["HOSTNAME"] = "127.0.0.1"
    env["NODE_ENV"] = "production"

    cwd = os.path.dirname(os.path.abspath(script))
    creationflags = 0x08000000 if sys.platform == "win32" else 0  # CREATE_NO_WINDOW

    try:
        _SERVER_PROCESS = subprocess.Popen(
            [runner, script],
            cwd=cwd,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creationflags,
        )
        return True
    except Exception:
        return False


def stop_server_process() -> None:
    """Terminate the spawned background server process when OrcaSlicer exits."""
    global _SERVER_PROCESS
    if _SERVER_PROCESS is not None:
        try:
            if _SERVER_PROCESS.poll() is None:
                _SERVER_PROCESS.terminate()
        except Exception:
            pass
        _SERVER_PROCESS = None


atexit.register(stop_server_process)


# ---------------------------------------------------------------------------
# Core G-Code Injection Engine
# ---------------------------------------------------------------------------

def is_binary_bgcode(data: Any) -> bool:
    """Check if raw G-code bytes start with the binary .bgcode header magic bytes ('GCDE')."""
    if not isinstance(data, (bytes, bytearray)):
        return False
    return data.startswith(b"GCDE")


def parse_bed_boundaries(gcode_text: str) -> tuple[float, float]:
    """
    Parse bed boundary limits (max_x, max_y) from G-code metadata comments
    such as '; bed_shape = ...' or '; printable_area = ...'.
    Defaults to (250.0, 210.0) if absent or unable to parse.
    """
    if not gcode_text:
        return DEFAULT_BED_LIMITS

    pattern = re.compile(
        r"^;\s*(?:bed_shape|printable_area)\s*=\s*([^\r\n]+)",
        re.IGNORECASE | re.MULTILINE,
    )
    match = pattern.search(gcode_text)
    if not match:
        return DEFAULT_BED_LIMITS

    raw_coords = match.group(1)
    pair_pattern = re.compile(r"(-?\d+(?:\.\d+)?)\s*x\s*(-?\d+(?:\.\d+)?)")
    pairs = pair_pattern.findall(raw_coords)

    if not pairs:
        return DEFAULT_BED_LIMITS

    max_x = max(float(x) for x, _ in pairs)
    max_y = max(float(y) for _, y in pairs)
    return (max_x, max_y)


def calculate_park_target(
    park_x: float,
    park_y: float,
    bed_max_x: float,
    bed_max_y: float,
) -> tuple[float, float]:
    """
    Calculate safe toolhead parking coordinates clamped to the printer's bed limits.
    Ensures target does not exceed bed_max - 10.0mm on either axis to prevent collisions.
    """
    target_x = min(float(park_x), float(bed_max_x) - 10.0)
    target_y = min(float(park_y), float(bed_max_y) - 10.0)
    return (target_x, target_y)


def _matches_marker(line: str, marker: str) -> bool:
    stripped = line.strip().upper()
    if stripped == marker:
        return True
    if stripped.startswith(marker) and len(stripped) > len(marker):
        next_char = stripped[len(marker)]
        if next_char in (" ", "\t", ";", "-"):
            return True
    return False


def inject_timelapse_gcode(
    gcode_text: str,
    config: dict[str, Any] | None = None,
) -> tuple[str, int]:
    """Inject toolhead parking and camera capture G-code at each layer change boundary."""
    if config is None:
        config = {}

    if not gcode_text:
        return (gcode_text, 0)

    park_x = float(config.get("parkX", config.get("park_x", 240.0)))
    park_y = float(config.get("parkY", config.get("park_y", 210.0)))
    z_hop = float(config.get("zHopHeight", config.get("z_hop_height", 0.4)))
    settle_time = int(config.get("settleTime", config.get("settle_time", 300)))
    capture_time = int(config.get("captureTime", config.get("capture_time", 1200)))

    # Parse bed boundaries and clamp target
    bed_max_x, bed_max_y = parse_bed_boundaries(gcode_text)
    if "bedMaxX" in config:
        bed_max_x = float(config["bedMaxX"])
    elif "bed_max_x" in config:
        bed_max_x = float(config["bed_max_x"])

    if "bedMaxY" in config:
        bed_max_y = float(config["bedMaxY"])
    elif "bed_max_y" in config:
        bed_max_y = float(config["bed_max_y"])

    target_x, target_y = calculate_park_target(park_x, park_y, bed_max_x, bed_max_y)

    lines = gcode_text.splitlines(keepends=True)
    if not lines:
        return (gcode_text, 0)

    nl = "\r\n" if any(line.endswith("\r\n") for line in lines) else "\n"

    has_after_layer = any(
        _matches_marker(line, ";AFTER_LAYER_CHANGE") for line in lines
    )
    target_marker = ";AFTER_LAYER_CHANGE" if has_after_layer else ";LAYER_CHANGE"

    snippet_lines = [START_MARKER]
    if z_hop > 0:
        snippet_lines.extend([
            "G91 ; Relative positioning",
            f"G1 Z{z_hop:.1f} F600 ; Z-hop lift",
            "G90 ; Absolute positioning",
        ])
    snippet_lines.extend([
        "M83 ; Strict relative extrusion",
        f"G1 X{target_x:.1f} Y{target_y:.1f} F9000",
        f"G4 P{settle_time} ; Settle delay",
        "M220 S99 ; Trigger camera capture via PrusaLink",
        f"G4 P{capture_time} ; Dwell for multi-camera capture",
        "M220 S100 ; Restore normal 100% print speed",
    ])
    if z_hop > 0:
        snippet_lines.extend([
            "G91 ; Relative positioning",
            f"G1 Z-{z_hop:.1f} F600 ; Restore Z height",
            "G90 ; Absolute positioning",
            "G1 F9000 ; Restore normal travel feedrate",
        ])
    snippet_lines.append(END_MARKER)

    injected_block = "".join(l + nl for l in snippet_lines)

    output: list[str] = []
    count = 0
    i = 0
    num_lines = len(lines)

    while i < num_lines:
        line = lines[i]
        output.append(line)
        if _matches_marker(line, target_marker):
            if i + 1 < num_lines and START_MARKER in lines[i + 1]:
                i += 1
                continue
            output.append(injected_block)
            count += 1
        i += 1

    return ("".join(output), count)


# ---------------------------------------------------------------------------
# Local Configuration Management
# ---------------------------------------------------------------------------

def get_default_config_path() -> str:
    """Return the absolute path to the bundled plugin config.json."""
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")


def load_local_config(config_path: str | None = None) -> dict[str, Any]:
    """Load local plugin configuration from JSON file."""
    if config_path is None:
        config_path = get_default_config_path()

    if not os.path.exists(config_path):
        return dict(DEFAULT_CONFIG)

    try:
        with open(config_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            merged = dict(DEFAULT_CONFIG)
            merged.update(data)
            return merged
        return dict(DEFAULT_CONFIG)
    except Exception:
        return dict(DEFAULT_CONFIG)


def save_local_config(data: dict[str, Any], config_path: str | None = None) -> None:
    """Persist local configuration dictionary to JSON file atomically."""
    if config_path is None:
        config_path = get_default_config_path()

    target_dir = os.path.dirname(os.path.abspath(config_path))
    os.makedirs(target_dir, exist_ok=True)

    temp_path = os.path.join(
        target_dir, f".config.tmp.{os.getpid()}"
    )
    with open(temp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(temp_path, config_path)


# ---------------------------------------------------------------------------
# Remote Config Synchronization
# ---------------------------------------------------------------------------

def fetch_remote_config(host: str, timeout: float = 1.5) -> dict[str, Any]:
    """Query GET {host}/api/config with a strict timeout."""
    cleaned_host = host.strip().rstrip("/")
    if not cleaned_host.startswith(("http://", "https://")):
        cleaned_host = f"http://{cleaned_host}"

    url = f"{cleaned_host}/api/config"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "PrusaLapse-OrcaSlicer-Plugin/1.3.2",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            if response.status == 200:
                body = response.read().decode("utf-8")
                payload = json.loads(body)
                if isinstance(payload, dict):
                    if "config" in payload and isinstance(payload["config"], dict):
                        return payload["config"]
                    return payload
    except Exception:
        pass
    return {}


def process_slicing_file(
    gcode_path: str, config_path: str | None = None
) -> dict[str, Any]:
    """Process an exported or post-slice G-code file in-place."""
    local_cfg = load_local_config(config_path)
    if not local_cfg.get("enabled", True):
        return {"status": "skipped_disabled"}

    if not os.path.exists(gcode_path):
        raise FileNotFoundError(f"G-code file not found: {gcode_path}")

    with open(gcode_path, "rb") as f:
        raw_bytes = f.read()

    if is_binary_bgcode(raw_bytes):
        return {"status": "skipped_binary"}

    host = str(local_cfg.get("host", "http://127.0.0.1:3000"))
    remote_cfg = fetch_remote_config(host, timeout=1.5)

    injection_cfg: dict[str, Any] = dict(local_cfg)
    if isinstance(remote_cfg, dict):
        if "slicer" in remote_cfg and isinstance(remote_cfg["slicer"], dict):
            injection_cfg.update(remote_cfg["slicer"])
        injection_cfg.update(remote_cfg)

    if (
        not injection_cfg.get("enabled", True)
        or not injection_cfg.get("autoInjectOrcaSlicer", True)
        or not injection_cfg.get("auto_inject_orcaslicer", True)
    ):
        return {"status": "skipped_disabled"}

    slicer_cfg = injection_cfg.get("slicer")
    if isinstance(slicer_cfg, dict):
        if (
            not slicer_cfg.get("autoInjectOrcaSlicer", True)
            or not slicer_cfg.get("auto_inject_orcaslicer", True)
        ):
            return {"status": "skipped_disabled"}

    gcode_text = raw_bytes.decode("utf-8", errors="replace")
    modified_text, count = inject_timelapse_gcode(gcode_text, injection_cfg)

    dir_name = os.path.dirname(os.path.abspath(gcode_path))
    temp_path = os.path.join(
        dir_name, f".{os.path.basename(gcode_path)}.tmp.{os.getpid()}"
    )
    with open(temp_path, "w", encoding="utf-8", newline="") as f:
        f.write(modified_text)
    os.replace(temp_path, gcode_path)

    return {"status": "success", "injected_layers": count}


# ---------------------------------------------------------------------------
# OrcaSlicer Capabilities & Environment Detection
# ---------------------------------------------------------------------------

try:
    import orca
    import orca.pages
    import orca.slicing
except ImportError:
    class _MockOrcaPages:
        class PagesPluginCapabilityBase:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                pass

    class _MockOrcaSlicing:
        class SlicingPipelineCapabilityBase:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                pass

        class Step:
            psGCodePostProcess = "psGCodePostProcess"

    class _MockOrcaExecutionResult:
        def __init__(self, success: bool = True, message: str = "") -> None:
            self._success = success
            self._message = message

        @classmethod
        def success(cls, message: str = "") -> _MockOrcaExecutionResult:
            return cls(True, message)

        @classmethod
        def fail(cls, message: str = "") -> _MockOrcaExecutionResult:
            return cls(False, message)

        @property
        def is_ok(self) -> bool:
            return self._success

        def __bool__(self) -> bool:
            return self._success

    class _MockOrcaLogger:
        @staticmethod
        def info(msg: str) -> None:
            pass

        @staticmethod
        def warning(msg: str) -> None:
            pass

        @staticmethod
        def error(msg: str) -> None:
            pass

    class _MockOrcaBase:
        pass

    class _MockOrca:
        pages = _MockOrcaPages
        slicing = _MockOrcaSlicing
        ExecutionResult = _MockOrcaExecutionResult
        logger = _MockOrcaLogger
        base = _MockOrcaBase

        @staticmethod
        def plugin(*args: Any, **kwargs: Any):
            def decorator(cls_or_func: Any) -> Any:
                return cls_or_func
            if len(args) == 1 and callable(args[0]):
                return args[0]
            return decorator

        @staticmethod
        def register_capability(*args: Any, **kwargs: Any) -> None:
            pass

        @staticmethod
        def request_permissions(*args: Any, **kwargs: Any) -> None:
            pass

    orca = _MockOrca()


# Request network and filesystem permissions from OrcaSlicer host runtime
if hasattr(orca, "request_permissions"):
    try:
        orca.request_permissions(
            network=["http://127.0.0.1:3000", "http://localhost:3000"],
            fs_read=["*"],
            fs_readwrite=["*"],
        )
    except Exception:
        pass


class PrusaLapsePage(orca.pages.PagesPluginCapabilityBase):
    """OrcaSlicer Page Plugin capability displaying the PrusaLapse web interface."""

    def __init__(self, config_path: str | None = None) -> None:
        super().__init__()
        self.config_path = config_path
        try:
            cfg = load_local_config(self.config_path)
            host = cfg.get("host", "http://127.0.0.1:3000")
            ensure_server_running(host)
        except Exception:
            pass

    def get_name(self) -> str:
        """Tab name displayed in OrcaSlicer upper navigation."""
        return "PrusaLapse"

    def get_ui(self) -> str:
        """Return HTML string embedding responsive iframe, loading screen, and postMessage bridge."""
        cfg = load_local_config(self.config_path)
        host = cfg.get("host", "http://127.0.0.1:3000")
        is_local = "127.0.0.1" in host or "localhost" in host

        if is_local:
            try:
                ensure_server_running(host)
            except Exception:
                pass
            server_alive = is_server_alive(host, timeout=0.3)
        else:
            server_alive = True

        initial_src = host if server_alive else ""
        initial_frame_display = "block" if server_alive else "none"
        initial_loader_display = "none" if server_alive else "flex"

        html_template = """<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>PrusaLapse</title>
  <style>
    * {
      box-sizing: border-box;
    }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #0f172a;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    #prusalapse-frame {
      width: 100%;
      height: 100%;
      border: none;
      display: __FRAME_DISPLAY__;
    }
    #loader-container {
      display: __LOADER_DISPLAY__;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      text-align: center;
      padding: 2rem;
      background: #0f172a;
    }
    .spinner {
      width: 48px;
      height: 48px;
      border: 4px solid #1e293b;
      border-top: 4px solid #38bdf8;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-bottom: 1.5rem;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    h2 {
      margin: 0 0 0.5rem 0;
      font-size: 1.6rem;
      color: #38bdf8;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    p {
      margin: 0 0 1.5rem 0;
      color: #94a3b8;
      max-width: 480px;
      line-height: 1.5;
      font-size: 0.95rem;
    }
    code {
      background: #1e293b;
      padding: 3px 8px;
      border-radius: 4px;
      color: #f1f5f9;
      font-size: 0.9rem;
    }
    .btn {
      background: #0284c7;
      color: white;
      border: none;
      padding: 10px 24px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 0.95rem;
      cursor: pointer;
      transition: background 0.15s ease;
      display: none;
    }
    .btn:hover {
      background: #0369a1;
    }
    .status-pill {
      font-size: 0.82rem;
      color: #64748b;
      margin-top: 0.5rem;
    }
  </style>
</head>
<body>
  <div id="loader-container">
    <div class="spinner" id="loader-spinner"></div>
    <h2 id="loader-title">PrusaLapse</h2>
    <p id="loader-msg">Starting embedded timelapse engine directly in OrcaSlicer...</p>
    <button class="btn" id="retry-btn" onclick="retryConnection()">Retry Connection</button>
    <div class="status-pill" id="poll-status">Connecting to local server...</div>
  </div>
  <iframe id="prusalapse-frame" src="__INITIAL_SRC__" allow="camera; microphone; display-capture"></iframe>
  <script>
    const host = "__HOST__";
    const frame = document.getElementById("prusalapse-frame");
    const loader = document.getElementById("loader-container");
    const spinner = document.getElementById("loader-spinner");
    const title = document.getElementById("loader-title");
    const msg = document.getElementById("loader-msg");
    const retryBtn = document.getElementById("retry-btn");
    const pollStatus = document.getElementById("poll-status");

    let isConnected = frame.style.display === "block" && frame.src.length > 0;
    let attempts = 0;
    const maxAttempts = 40; // 40 * 350ms = 14s

    function probe() {
      if (isConnected) return;
      fetch(host + "/api/config", { cache: "no-store" })
        .then(function(res) {
          if (res.ok) {
            isConnected = true;
            frame.src = host;
            frame.style.display = "block";
            loader.style.display = "none";
          } else {
            handleFailedProbe();
          }
        })
        .catch(function() {
          handleFailedProbe();
        });
    }

    function handleFailedProbe() {
      attempts++;
      if (attempts >= maxAttempts) {
        spinner.style.display = "none";
        title.textContent = "Embedded Server Did Not Respond";
        title.style.color = "#f87171";
        msg.innerHTML = "Could not connect to <code>" + host + "</code>.<br>Click Retry to attempt re-launching the embedded server.";
        retryBtn.style.display = "inline-block";
        pollStatus.textContent = "Server initialization timed out.";
      } else {
        setTimeout(probe, 350);
      }
    }

    function retryConnection() {
      attempts = 0;
      spinner.style.display = "block";
      title.textContent = "PrusaLapse";
      title.style.color = "#38bdf8";
      msg.textContent = "Re-launching embedded server...";
      retryBtn.style.display = "none";
      pollStatus.textContent = "Connecting to local server...";
      if (window.orca && window.orca.postMessage) {
        window.orca.postMessage(JSON.stringify({ action: "start_server" }));
      }
      setTimeout(probe, 500);
    }

    if (!isConnected) {
      probe();
    }

    window.addEventListener('message', function(event) {
      if (event.data && typeof event.data === 'object') {
        if (event.data.type === 'save_config' || event.data.action === 'save_config') {
          if (window.orca && window.orca.postMessage) {
            window.orca.postMessage(JSON.stringify(event.data));
          }
        }
      }
    });
  </script>
</body>
</html>"""
        return (
            html_template
            .replace("__HOST__", host)
            .replace("__INITIAL_SRC__", initial_src)
            .replace("__FRAME_DISPLAY__", initial_frame_display)
            .replace("__LOADER_DISPLAY__", initial_loader_display)
        )

    def on_message(self, message: Any) -> None:
        """Handle IPC message received from webview."""
        if isinstance(message, str):
            try:
                message = json.loads(message)
            except Exception:
                return

        if isinstance(message, dict):
            msg_type = message.get("type") or message.get("action")
            if msg_type in ("start_server", "retry_server"):
                cfg = load_local_config(self.config_path)
                host = cfg.get("host", "http://127.0.0.1:3000")
                ensure_server_running(host)
                return

            if msg_type == "save_config":
                cfg = load_local_config(self.config_path)
                changed = False
                if "host" in message and message.get("host"):
                    cfg["host"] = str(message["host"])
                    changed = True
                if "enabled" in message:
                    cfg["enabled"] = bool(message["enabled"])
                    changed = True
                if changed:
                    save_local_config(cfg, self.config_path)


class PrusaLapseSlicingHook(orca.slicing.SlicingPipelineCapabilityBase):
    """OrcaSlicer Slicing Pipeline capability intercepting psGCodePostProcess."""

    def __init__(self, config_path: str | None = None) -> None:
        super().__init__()
        self.config_path = config_path

    def get_name(self) -> str:
        """Capability name."""
        return "PrusaLapse Slicing Hook"

    def execute(self, ctx: Any) -> Any:
        step = getattr(ctx, "step", None)
        expected_step = getattr(orca.slicing.Step, "psGCodePostProcess", "psGCodePostProcess")
        if step != expected_step:
            return orca.ExecutionResult.success()

        gcode_path = getattr(ctx, "gcode_path", getattr(ctx, "output_filepath", None))
        if not gcode_path or not os.path.exists(gcode_path):
            return orca.ExecutionResult.success()

        try:
            res = process_slicing_file(gcode_path, self.config_path)
            logger = getattr(orca, "logger", None)
            if logger and hasattr(logger, "info"):
                logger.info(
                    f"PrusaLapse: {res.get('status')} (layers: {res.get('injected_layers', 0)})"
                )
        except Exception as e:
            logger = getattr(orca, "logger", None)
            if logger and hasattr(logger, "warning"):
                logger.warning(f"PrusaLapse post-processing error: {e}")

        return orca.ExecutionResult.success()


# Register capability classes with OrcaSlicer host runtime
if hasattr(orca, "register_capability"):
    try:
        orca.register_capability(PrusaLapsePage)
        orca.register_capability(PrusaLapseSlicingHook)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Plugin Package Entry Point
# ---------------------------------------------------------------------------

_BasePluginClass = getattr(orca, "base", object)

@orca.plugin
class PrusaLapsePlugin(_BasePluginClass):
    id = "prusalapse"
    name = "PrusaLapse"
    version = "1.3.3"
    description = "Native PrusaLapse dual-camera timelapse integration for OrcaSlicer"
    author = "PrusaLapse"
    page = PrusaLapsePage
    slicing_hook = PrusaLapseSlicingHook

    def on_load(self) -> None:
        try:
            cfg = load_local_config()
            host = cfg.get("host", "http://127.0.0.1:3000")
            ensure_server_running(host)
        except Exception:
            pass

    def on_unload(self) -> None:
        try:
            stop_server_process()
        except Exception:
            pass
