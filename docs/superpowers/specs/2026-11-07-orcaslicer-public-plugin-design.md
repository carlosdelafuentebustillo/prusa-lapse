# Design Document: OrcaSlicer Public Plugin Standards Compliance

**Date:** 2026-11-07  
**Status:** Pending Approval  
**Workspace:** `prusa-lapse`  
**Target Component:** [`orcaslicer-plugin/prusalapse/plugin.py`](../../../orcaslicer-plugin/prusalapse/plugin.py)

---

## 1. Intent & Context
Upgrade the native PrusaLapse OrcaSlicer plugin to fully conform to the official [OrcaSlicer Python Plugin Development Specification](https://www.orcaslicer.com/wiki/developer_reference/plugin_development/plugin_development.html) and [Plugin System Overview](https://www.orcaslicer.com/wiki/developer_reference/plugin_development/plugin_system.html). This ensures seamless operation within OrcaSlicer 2.5+ embedded CPython environment and qualifies the plugin for submission to the OrcaSlicer public plugins catalog / OrcaCloud.

---

## 2. Goals, Non-Goals & Anti-Goals

### Goals
- **PEP 723 Metadata**: Conform strictly to the parser schema in `parse_pep723_toml` (`[tool.orcaslicer.plugin]` with `name`, `description`, `author`, `version = "1.3.7"`, and root `requires-python = ">=3.10"`, `dependencies = []`).
- **Capability Registration**: Implement capability registration inside `register_capabilities(self)` on `@orca.plugin class PrusaLapsePlugin(orca.base)` rather than at module import level.
- **Audit Hook & Permissions**: Declare all required permissions via `orca.request_permissions(...)` during `register_capabilities(self)` using standard C++ parameter names (`network_http`, `fs_read`, `fs_readwrite`, `process`) to present a single unified prompt to the user on load.
- **Slicing Hook Error Propagation**: Ensure `PrusaLapseSlicingHook.execute(self, ctx)` returns `orca.ExecutionResult.failure(str(e))` on post-processing exceptions so OrcaSlicer plater displays an informative failure dialog instead of silent failure.
- **Zero-Dependency Portability**: Maintain pure Python standard library usage across Windows, macOS, and Linux.
- **Offline / Unit Test Compatibility**: Maintain backward-compatible mock fallbacks so test suites execute cleanly in standalone CPython environments without the OrcaSlicer embedded binary.

### Non-Goals
- Modifying the underlying G-code injection algorithm (bed clearance, M83 relative extrusion, layer parking) which is already mature and verified.
- Packaging as a multi-file binary wheel (`.whl`).

### Anti-Goals
- Adding heavy 3rd-party dependencies (e.g. `requests`, `pydantic`) that require runtime `uv` resolution.
- Breaking existing configuration keys in `prusa-lapse.config.json` or webapp endpoints.

---

## 3. Approaches Considered & Trade-offs

### Approach A: Self-Contained Single-File Script (`plugin.py`) — **CHOSEN**
- **Description**: Keep the entire plugin (metadata, `@orca.plugin` root package, `PagesPluginCapabilityBase`, `SlicingPipelineCapabilityBase`, webview IPC bridge, and G-code parser) in a single portable `.py` file.
- **Pros**:
  - Matches the standard distribution format for OrcaSlicer public catalog plugins.
  - Easiest for OrcaSlicer core maintainers to audit and approve in a pull request.
  - Zero build step, runs identically on Windows, Linux, and macOS.
  - Clean side-loading via OrcaSlicer's *Install local plugin* dialog.
- **Cons**:
  - All plugin logic resides in one file (~950 lines), requiring clean internal modular structure.

### Approach B: Multi-File Python Wheel (`.whl`) — **REJECTED**
- **Description**: Package the plugin as a Python wheel with `pyproject.toml` and separate submodule files.
- **Trade-offs**: Adds packaging, build, and version distribution complexity without any binary/C extension requirements. OrcaSlicer documentation specifically recommends single-file scripts for pure Python plugins.

---

## 4. Technical Design

### 4.1. PEP 723 Metadata Header
```toml
# /// script
# requires-python = ">=3.10"
# dependencies = []
#
# [tool.orcaslicer.plugin]
# name = "PrusaLapse"
# description = "Cinematic Multi-Camera Timelapse Controller & G-code Injector"
# author = "Carlos de la Fuente Bustillo"
# version = "1.3.7"
# ///
```

### 4.2. Plugin Package & Lifecycle
```python
_BasePluginClass = getattr(orca, "base", object)

@orca.plugin
class PrusaLapsePlugin(_BasePluginClass):
    id = "prusalapse"
    name = "PrusaLapse"
    version = "1.3.7"
    description = "Cinematic Multi-Camera Timelapse Controller & G-code Injector"
    author = "Carlos de la Fuente Bustillo"

    def register_capabilities(self) -> None:
        """Called by OrcaSlicer to register capabilities and declare permissions."""
        if hasattr(orca, "request_permissions"):
            try:
                orca.request_permissions(
                    network_http=["http://127.0.0.1:3000", "http://localhost:3000"],
                    fs_read=["*"],
                    fs_readwrite=["*"],
                    process=["*"],
                )
            except Exception:
                pass

        if hasattr(orca, "register_capability"):
            try:
                orca.register_capability(PrusaLapsePage)
                orca.register_capability(PrusaLapseSlicingHook)
            except Exception:
                pass

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
```

### 4.3. Slicing Pipeline Capability
```python
class PrusaLapseSlicingHook(orca.slicing.SlicingPipelineCapabilityBase):
    """OrcaSlicer Slicing Pipeline capability intercepting psGCodePostProcess."""

    def __init__(self, config_path: str | None = None) -> None:
        super().__init__()
        self.config_path = config_path

    def get_name(self) -> str:
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
            return orca.ExecutionResult.success()
        except Exception as e:
            logger = getattr(orca, "logger", None)
            if logger and hasattr(logger, "warning"):
                logger.warning(f"PrusaLapse post-processing error: {e}")
            return orca.ExecutionResult.failure(f"PrusaLapse post-processing error: {e}")
```

### 4.4. Mock / Offline Compatibility Layer
Update `_MockOrca` in [`plugin.py`](../../../orcaslicer-plugin/prusalapse/plugin.py) so:
- `_MockOrca.base` has a `register_capabilities(self)` stub.
- `_MockOrca.request_permissions(**kwargs)` captures declared permissions for inspection in tests.
- `_MockOrca.register_capability(cls)` tracks registered capability classes.
- `_MockOrca.ExecutionResult` provides `.success()`, `.failure(msg)`, and `.skipped()`.

---

## 5. Verification Strategy
1. **Unit Tests**:
   - Run `python -m unittest discover -s orcaslicer-plugin/tests -p "test_*.py"` to verify all 25+ tests pass with the new capability registration and permission declarations.
   - Verify PEP 723 comment block matches regex parser expectations.
2. **Integration Verification**:
   - Run Webapp Slicer API test suite: `node webapp/tests/slicer-api.test.js`.
   - Verify G-code injection test files produce expected layer comments and parking triggers.
3. **Version Check**:
   - Verify consistency across `firmware/src/main.cpp` (`1.3.7`), `webapp/package.json` (`1.3.7`), and `plugin.py` (`1.3.7`).
