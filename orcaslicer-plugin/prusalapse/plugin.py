"""
OrcaSlicer native plugin implementation for PrusaLapse.

Provides:
- Page Plugin (wxWebView iframe embedding the PrusaLapse web interface)
- Slicing Pipeline Hook (psGCodePostProcess in-place G-code injection)
- Local configuration management (config.json)
- Remote config synchronization via /api/config with graceful offline fallback
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import urllib.error
import urllib.request
from typing import Any

from .injector import inject_timelapse_gcode, is_binary_bgcode

DEFAULT_CONFIG: dict[str, Any] = {
    "host": "http://127.0.0.1:3000",
    "enabled": True,
}

# ---------------------------------------------------------------------------
# OrcaSlicer Environment & Fallback Mocking
# ---------------------------------------------------------------------------

try:
    import orca
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

    class _MockOrca:
        pages = _MockOrcaPages
        slicing = _MockOrcaSlicing
        ExecutionResult = _MockOrcaExecutionResult
        logger = _MockOrcaLogger

        @staticmethod
        def plugin(*args: Any, **kwargs: Any):
            def decorator(cls_or_func: Any) -> Any:
                return cls_or_func

            return decorator

    orca = _MockOrca()


# ---------------------------------------------------------------------------
# Local Configuration Management
# ---------------------------------------------------------------------------

def get_default_config_path() -> str:
    """Return the absolute path to the bundled plugin config.json."""
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")


def load_local_config(config_path: str | None = None) -> dict[str, Any]:
    """
    Load local plugin configuration from JSON file.

    Falls back safely to DEFAULT_CONFIG if the file does not exist or fails to parse.

    Args:
        config_path: Optional explicit path to configuration file.

    Returns:
        Dictionary containing local configuration.
    """
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
    """
    Persist local configuration dictionary to JSON file atomically.

    Args:
        data: Configuration dictionary to persist.
        config_path: Optional explicit path to configuration file.
    """
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
    """
    Query GET {host}/api/config with a strict timeout.

    Falls back safely to an empty dict if the host is offline or times out.

    Args:
        host: Host URL (e.g. http://127.0.0.1:3000).
        timeout: Maximum network timeout in seconds (default: 1.5s).

    Returns:
        Parsed configuration dictionary from remote host, or empty dict on failure.
    """
    cleaned_host = host.strip().rstrip("/")
    if not cleaned_host.startswith(("http://", "https://")):
        cleaned_host = f"http://{cleaned_host}"

    url = f"{cleaned_host}/api/config"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "PrusaLapse-OrcaSlicer-Plugin/1.3.0",
            "Accept": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status == 200:
                body = resp.read().decode("utf-8")
                payload = json.loads(body)
                if isinstance(payload, dict):
                    if "config" in payload and isinstance(payload["config"], dict):
                        return payload["config"]
                    return payload
    except Exception:
        pass

    return {}


# ---------------------------------------------------------------------------
# Slicing File Processor
# ---------------------------------------------------------------------------

def process_slicing_file(
    gcode_path: str,
    config_path: str | None = None,
) -> dict[str, Any]:
    """
    Standalone G-code slicing file processor.

    1. Checks if plugin is enabled in local configuration; skips if disabled.
    2. Inspects file for binary .bgcode header; skips if binary.
    3. Fetches active park parameters from remote {host}/api/config with 1.5s timeout;
       falls back safely to default config if offline.
    4. Runs inject_timelapse_gcode with boundary safety clamping.
    5. Writes modified G-code back to disk in-place atomically.

    Args:
        gcode_path: Absolute path to the sliced G-code file.
        config_path: Optional explicit configuration path.

    Returns:
        Dictionary with status and injection count:
        - {"status": "skipped_disabled"}
        - {"status": "skipped_binary"}
        - {"status": "success", "injected_layers": count}
    """
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

    # Merge configuration: local config defaults overridden by remote active config
    injection_cfg: dict[str, Any] = dict(local_cfg)
    if isinstance(remote_cfg, dict):
        if "slicer" in remote_cfg and isinstance(remote_cfg["slicer"], dict):
            injection_cfg.update(remote_cfg["slicer"])
        injection_cfg.update(remote_cfg)

    gcode_text = raw_bytes.decode("utf-8", errors="replace")
    modified_text, count = inject_timelapse_gcode(gcode_text, injection_cfg)

    # In-place atomic file write
    dir_name = os.path.dirname(os.path.abspath(gcode_path))
    temp_path = os.path.join(
        dir_name, f".{os.path.basename(gcode_path)}.tmp.{os.getpid()}"
    )
    with open(temp_path, "w", encoding="utf-8", newline="") as f:
        f.write(modified_text)
    os.replace(temp_path, gcode_path)

    return {"status": "success", "injected_layers": count}


# ---------------------------------------------------------------------------
# OrcaSlicer Capabilities
# ---------------------------------------------------------------------------

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

        if isinstance(message, dict) and message.get("type") == "save_config":
            new_host = message.get("host")
            if new_host:
                cfg = load_local_config(self.config_path)
                cfg["host"] = new_host
                if "enabled" in message:
                    cfg["enabled"] = bool(message["enabled"])
                save_local_config(cfg, self.config_path)


class PrusaLapseSlicingHook(orca.slicing.SlicingPipelineCapabilityBase):
    """OrcaSlicer Slicing Pipeline capability intercepting psGCodePostProcess."""

    def __init__(self, config_path: str | None = None) -> None:
        super().__init__()
        self.config_path = config_path

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


# ---------------------------------------------------------------------------
# Plugin Declaration
# ---------------------------------------------------------------------------

@orca.plugin(
    id="prusalapse",
    name="PrusaLapse",
    version="1.3.0",
    description="Native PrusaLapse dual-camera timelapse integration for OrcaSlicer",
    author="PrusaLapse",
    permissions=["network", "filesystem"],
    capabilities=[PrusaLapsePage, PrusaLapseSlicingHook],
)
class PrusaLapsePlugin:
    page = PrusaLapsePage
    slicing_hook = PrusaLapseSlicingHook
