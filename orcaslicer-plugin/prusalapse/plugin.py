# /// script
# name = "prusalapse"
# version = "1.3.1"
# description = "Native PrusaLapse dual-camera timelapse integration for OrcaSlicer"
# authors = [{name = "PrusaLapse"}]
# requires-python = ">=3.10"
# dependencies = []
# [tool.orcaslicer.plugin]
# name = "prusalapse"
# version = "1.3.1"
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

import json
import os
import re
import sys
import tempfile
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
            "User-Agent": "PrusaLapse-OrcaSlicer-Plugin/1.3.1",
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

    def get_name(self) -> str:
        """Tab name displayed in OrcaSlicer upper navigation."""
        return "PrusaLapse"

    def get_ui(self) -> str:
        """Return HTML string embedding responsive iframe and postMessage bridge."""
        cfg = load_local_config(self.config_path)
        host = cfg.get("host", "http://127.0.0.1:3000")

        return f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html, body {{
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #121212;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }}
    #prusalapse-frame {{
      width: 100%;
      height: 100%;
      border: none;
    }}
  </style>
</head>
<body>
  <iframe id="prusalapse-frame" src="{host}" allow="camera; microphone; display-capture"></iframe>
  <script>
    window.addEventListener('message', function(event) {{
      if (event.data && typeof event.data === 'object') {{
        if (event.data.type === 'save_config' || event.data.action === 'save_config') {{
          if (window.orca && window.orca.postMessage) {{
            window.orca.postMessage(JSON.stringify(event.data));
          }}
        }}
      }}
    }});
  </script>
</body>
</html>"""

    def on_message(self, message: Any) -> None:
        """Handle IPC message received from webview."""
        if isinstance(message, str):
            try:
                message = json.loads(message)
            except Exception:
                return

        if isinstance(message, dict):
            msg_type = message.get("type") or message.get("action")
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
    version = "1.3.1"
    description = "Native PrusaLapse dual-camera timelapse integration for OrcaSlicer"
    author = "PrusaLapse"
    page = PrusaLapsePage
    slicing_hook = PrusaLapseSlicingHook

    def on_load(self) -> None:
        pass

    def on_unload(self) -> None:
        pass
