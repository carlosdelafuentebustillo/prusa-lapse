# OrcaSlicer Public Plugin Standards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the native PrusaLapse OrcaSlicer plugin to full compliance with the official OrcaSlicer Python plugin specification for public catalog submission.

**Architecture:** Maintain a zero-dependency, self-contained single-file script (`plugin.py`). Formalize the PEP 723 metadata header, embed permission requests and capability registration inside `@orca.plugin class PrusaLapsePlugin.register_capabilities(self)`, surface slicing post-processing errors via `orca.ExecutionResult.failure`, and maintain offline test mock fidelity.

**Tech Stack:** Python 3.10+, OrcaSlicer CPython embedded plugin API (`orca.base`, `orca.slicing`, `orca.pages`, `orca.ExecutionResult`), `unittest`.

**Spec:** [`docs/superpowers/specs/2026-11-07-orcaslicer-public-plugin-design.md`](../specs/2026-11-07-orcaslicer-public-plugin-design.md)

---

## Global Constraints

- Platform: Windows, Linux, macOS portable pure-Python (no external 3rd-party dependencies required).
- Python version floor: `>=3.10`.
- Version: `1.3.7` matching webapp and firmware.
- Git push rule: Never execute `git push` without explicit user confirmation (workspace: `dual-dalmatian`).
- Presets & Preserved logic: Preserve all existing G-code injection, bed boundary calculation, and relative extrusion (M83) logic.

## Review Focus

1. Permission parameter grammar: `network_http`, `fs_read`, `fs_readwrite`, and `process` must be `list[str]` conforming to OrcaSlicer's audit manager.
2. Missing or empty `ctx.gcode_path`: Post-processing hook must gracefully return `ExecutionResult.success()` without raising exceptions.
3. Unexpected post-processing exception: Hook must catch and return `ExecutionResult.failure(msg)` with exact error detail.
4. Offline mock parity: `_MockOrca` must mirror `orca.base.register_capabilities`, `request_permissions`, and `ExecutionResult` without requiring OrcaSlicer's C++ binaries.
5. Idempotent registration: Calling `register_capabilities()` multiple times must not raise errors.

---

### Task 1: Offline Mock Harness & ExecutionResult Enhancements

**Files:**
- Modify: [`orcaslicer-plugin/prusalapse/plugin.py:560-615`](../../../orcaslicer-plugin/prusalapse/plugin.py#L560-L615)
- Test: [`orcaslicer-plugin/tests/test_plugin_bridge.py`](../../../orcaslicer-plugin/tests/test_plugin_bridge.py)

- [ ] Step 1: Write unit tests in `test_plugin_bridge.py` verifying `orca.ExecutionResult.failure(msg)` sets status to `"failure"` and stores message, and `orca.request_permissions` records arguments.
- [ ] Step 2: Run `python -m unittest orcaslicer-plugin/tests/test_plugin_bridge.py` and confirm failure on unenhanced mock.
- [ ] Step 3: Enhance `_MockOrca` in `plugin.py`:
  - Add `base.register_capabilities(self)`.
  - Add `request_permissions(**kwargs)` storing declared permissions.
  - Add `register_capability(cls)` tracking registered classes.
  - Add `ExecutionResult.failure(message)` setting status and message.
- [ ] Step 4: Run unit tests and confirm they pass.
- [ ] Step 5: Commit changes locally.

---

### Task 2: PEP 723 Metadata & Plugin Package Class Registration

**Files:**
- Modify: [`orcaslicer-plugin/prusalapse/plugin.py:1-25`](../../../orcaslicer-plugin/prusalapse/plugin.py#L1-L25), [`orcaslicer-plugin/prusalapse/plugin.py:900-940`](../../../orcaslicer-plugin/prusalapse/plugin.py#L900-L940)
- Test: [`orcaslicer-plugin/tests/test_plugin_bridge.py`](../../../orcaslicer-plugin/tests/test_plugin_bridge.py)

- [ ] Step 1: Write unit tests in `test_plugin_bridge.py` to:
  - Test PEP 723 script metadata header using TOML/regex matching (`name = "PrusaLapse"`, `version = "1.3.7"`, `author = "Carlos de la Fuente Bustillo"`).
  - Test calling `PrusaLapsePlugin.register_capabilities()` and verifying `request_permissions` was invoked with `network_http`, `fs_read`, `fs_readwrite`, and `process`.
  - Test verifying `PrusaLapsePage` and `PrusaLapseSlicingHook` are registered capabilities.
  - Update `test_plugin_lifecycle` to assert `plugin.version == "1.3.7"`.
- [ ] Step 2: Run tests and verify failure.
- [ ] Step 3: Update `plugin.py`:
  - Update PEP 723 header to clean OrcaSlicer catalog schema and version `1.3.7`.
  - Implement `register_capabilities(self)` on `PrusaLapsePlugin`.
  - Clean up top-level module-scope `request_permissions` and `register_capability` calls.
- [ ] Step 4: Run unit tests and verify they pass.
- [ ] Step 5: Commit changes locally.

---

### Task 3: Slicing Pipeline Capability Error Propagation

**Files:**
- Modify: [`orcaslicer-plugin/prusalapse/plugin.py:865-900`](../../../orcaslicer-plugin/prusalapse/plugin.py#L865-L900)
- Test: [`orcaslicer-plugin/tests/test_plugin_bridge.py`](../../../orcaslicer-plugin/tests/test_plugin_bridge.py)

- [ ] Step 1: Write unit test verifying `PrusaLapseSlicingHook.execute(ctx)` returns `ExecutionResult.failure(...)` when `process_slicing_file` raises an exception or fails fatally.
- [ ] Step 2: Run test and confirm failure (currently returns `success()` on error).
- [ ] Step 3: Update `PrusaLapseSlicingHook.execute` to return `orca.ExecutionResult.failure(f"PrusaLapse post-processing error: {e}")`.
- [ ] Step 4: Run tests and verify they pass.
- [ ] Step 5: Commit changes locally.

---

### Task 4: Full Test Suite & End-to-End Verification

**Files:**
- Test: [`orcaslicer-plugin/tests/test_plugin_bridge.py`](../../../orcaslicer-plugin/tests/test_plugin_bridge.py)
- Test: [`orcaslicer-plugin/tests/test_injector.py`](../../../orcaslicer-plugin/tests/test_injector.py)
- Test: [`webapp/tests/slicer-api.test.js`](../../../webapp/tests/slicer-api.test.js)

- [ ] Step 1: Run all Python unit tests: `python -m unittest discover -s orcaslicer-plugin/tests -p "test_*.py"`.
- [ ] Step 2: Run Slicer API integration tests: `node webapp/tests/slicer-api.test.js`.
- [ ] Step 3: Verify version consistency across all project components (`plugin.py` -> `1.3.7`, `firmware/src/main.cpp` -> `1.3.7`, `webapp/package.json` -> `1.3.7`).
- [ ] Step 4: Commit changes locally and verify clean working tree.
