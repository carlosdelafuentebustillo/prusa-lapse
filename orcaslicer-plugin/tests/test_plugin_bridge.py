import io
import json
import os
import re
import sys
import tempfile
import unittest
from unittest.mock import patch, MagicMock

try:
    import tomllib
except ImportError:
    try:
        import tomli as tomllib
    except ImportError:
        tomllib = None

# Ensure orcaslicer-plugin root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from prusalapse.plugin import (
    load_local_config,
    save_local_config,
    process_slicing_file,
    PrusaLapsePage,
    PrusaLapseSlicingHook,
    PrusaLapsePlugin,
    is_server_alive,
    find_server_components,
    ensure_server_running,
    stop_server_process,
    orca,
)


class TestPluginBridge(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.config_path = os.path.join(self.temp_dir.name, "config.json")

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_config_lifecycle(self):
        save_local_config({"host": "http://192.168.1.100:3000", "enabled": True}, self.config_path)
        loaded = load_local_config(self.config_path)
        self.assertEqual(loaded["host"], "http://192.168.1.100:3000")
        self.assertTrue(loaded["enabled"])

    def test_default_config_fallback(self):
        non_existent = os.path.join(self.temp_dir.name, "does_not_exist.json")
        loaded = load_local_config(non_existent)
        self.assertEqual(loaded.get("host"), "http://127.0.0.1:3000")
        self.assertTrue(loaded.get("enabled"))

    def test_process_slicing_file_disabled(self):
        gcode_path = os.path.join(self.temp_dir.name, "test.gcode")
        with open(gcode_path, "w", encoding="utf-8") as f:
            f.write(";AFTER_LAYER_CHANGE\nG1 X10 Y10\n")

        # Disabled in local config
        save_local_config({"host": "http://127.0.0.1:3000", "enabled": False}, self.config_path)
        result = process_slicing_file(gcode_path, self.config_path)
        self.assertEqual(result["status"], "skipped_disabled")

        with open(gcode_path, "r", encoding="utf-8") as f:
            content = f.read()
            self.assertNotIn("M220 S99", content)

    def test_process_slicing_file_binary_bgcode(self):
        bgcode_path = os.path.join(self.temp_dir.name, "sample.bgcode")
        with open(bgcode_path, "wb") as f:
            f.write(b"GCDE\x01\x00\x00\x00binarydatastream")

        save_local_config({"host": "http://127.0.0.1:3000", "enabled": True}, self.config_path)
        result = process_slicing_file(bgcode_path, self.config_path)
        self.assertEqual(result["status"], "skipped_binary")

        with open(bgcode_path, "rb") as f:
            self.assertEqual(f.read(), b"GCDE\x01\x00\x00\x00binarydatastream")

    def test_process_slicing_file_offline_fallback(self):
        gcode_path = os.path.join(self.temp_dir.name, "test_offline.gcode")
        with open(gcode_path, "w", encoding="utf-8") as f:
            f.write("; bed_shape = 0x0,250x0,250x210,0x210\n;AFTER_LAYER_CHANGE\nG1 X10 Y10\n")

        # Point to unreachable host to trigger offline fallback
        save_local_config({"host": "http://192.0.2.1:9999", "enabled": True}, self.config_path)
        result = process_slicing_file(gcode_path, self.config_path)
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["injected_layers"], 1)

        with open(gcode_path, "r", encoding="utf-8") as f:
            content = f.read()
            self.assertIn("M220 S99", content)
            self.assertIn("G1 X240.0 Y200.0 F9000", content)

    @patch("urllib.request.urlopen")
    def test_process_slicing_file_with_remote_config(self, mock_urlopen):
        # Mock remote response from /api/config
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.read.return_value = json.dumps({
            "config": {
                "parkX": 210.0,
                "parkY": 190.0,
                "settleTime": 450,
                "captureTime": 1500,
            }
        }).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        gcode_path = os.path.join(self.temp_dir.name, "test_remote.gcode")
        with open(gcode_path, "w", encoding="utf-8") as f:
            f.write("; bed_shape = 0x0,250x0,250x210,0x210\n;AFTER_LAYER_CHANGE\nG1 X10 Y10\n")

        save_local_config({"host": "http://127.0.0.1:3000", "enabled": True}, self.config_path)
        result = process_slicing_file(gcode_path, self.config_path)

        self.assertEqual(result["status"], "success")
        self.assertEqual(result["injected_layers"], 1)

        with open(gcode_path, "r", encoding="utf-8") as f:
            content = f.read()
            self.assertIn("G1 X210.0 Y190.0 F9000", content)
            self.assertIn("G4 P450 ; Settle delay", content)
            self.assertIn("G4 P1500 ; Dwell for multi-camera capture", content)

    @patch("urllib.request.urlopen")
    def test_process_slicing_file_remote_auto_inject_disabled(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.read.return_value = json.dumps({
            "config": {
                "slicer": {
                    "autoInjectOrcaSlicer": False,
                }
            }
        }).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        gcode_path = os.path.join(self.temp_dir.name, "test_remote_disabled.gcode")
        initial_content = "; bed_shape = 0x0,250x0,250x210,0x210\n;AFTER_LAYER_CHANGE\nG1 X10 Y10\n"
        with open(gcode_path, "w", encoding="utf-8") as f:
            f.write(initial_content)

        save_local_config({"host": "http://127.0.0.1:3000", "enabled": True}, self.config_path)
        result = process_slicing_file(gcode_path, self.config_path)

        self.assertEqual(result["status"], "skipped_disabled")
        with open(gcode_path, "r", encoding="utf-8") as f:
            self.assertEqual(f.read(), initial_content)

    def test_page_capability_ui_and_message(self):
        page = PrusaLapsePage(config_path=self.config_path)
        self.assertEqual(page.get_name(), "PrusaLapse")

        save_local_config({"host": "http://myprinter:3000", "enabled": True}, self.config_path)
        html = page.get_ui()
        self.assertIn('src="http://myprinter:3000"', html)
        self.assertIn("postMessage", html)

        # Test updating host via message bridge (type: save_config)
        page.on_message({"type": "save_config", "host": "http://newhost:3000"})
        loaded = load_local_config(self.config_path)
        self.assertEqual(loaded["host"], "http://newhost:3000")
        self.assertTrue(loaded["enabled"])

        # Test updating enabled independently of host (action: save_config parity)
        page.on_message({"action": "save_config", "enabled": False})
        loaded_after = load_local_config(self.config_path)
        self.assertEqual(loaded_after["host"], "http://newhost:3000")
        self.assertFalse(loaded_after["enabled"])

    def test_slicing_hook_capability(self):
        hook = PrusaLapseSlicingHook(config_path=self.config_path)
        save_local_config({"host": "http://127.0.0.1:3000", "enabled": True}, self.config_path)

        gcode_path = os.path.join(self.temp_dir.name, "test_hook.gcode")
        with open(gcode_path, "w", encoding="utf-8") as f:
            f.write("; bed_shape = 0x0,250x0,250x210,0x210\n;AFTER_LAYER_CHANGE\nG1 X10 Y10\n")

        # Post-process step triggers injection
        ctx = MagicMock()
        ctx.step = getattr(orca.slicing.Step, "psGCodePostProcess", "psGCodePostProcess")
        ctx.gcode_path = gcode_path

        result = hook.execute(ctx)
        self.assertTrue(result.is_ok if hasattr(result, "is_ok") else result)

        with open(gcode_path, "r", encoding="utf-8") as f:
            content = f.read()
            self.assertIn("M220 S99", content)

        # Other step skips execution safely
        ctx_other = MagicMock()
        ctx_other.step = "psOtherStep"
        ctx_other.gcode_path = gcode_path
        res_other = hook.execute(ctx_other)
        self.assertTrue(res_other.is_ok if hasattr(res_other, "is_ok") else res_other)

    @patch("prusalapse.plugin.process_slicing_file")
    def test_slicing_hook_error_propagation(self, mock_process):
        hook = PrusaLapseSlicingHook(config_path=self.config_path)
        gcode_path = os.path.join(self.temp_dir.name, "test_err.gcode")
        with open(gcode_path, "w", encoding="utf-8") as f:
            f.write(";AFTER_LAYER_CHANGE\n")

        ctx = MagicMock()
        ctx.step = getattr(orca.slicing.Step, "psGCodePostProcess", "psGCodePostProcess")
        ctx.gcode_path = gcode_path

        # Fatal exception during processing returns failure
        mock_process.side_effect = RuntimeError("I/O error during G-code write")
        res_fail = hook.execute(ctx)
        self.assertFalse(res_fail.is_ok)
        self.assertEqual(res_fail.status, "failure")
        self.assertIn("PrusaLapse post-processing error: I/O error during G-code write", res_fail.message)

        # Non-matching step returns success
        ctx_wrong_step = MagicMock()
        ctx_wrong_step.step = "psOtherStep"
        ctx_wrong_step.gcode_path = gcode_path
        res_step = hook.execute(ctx_wrong_step)
        self.assertTrue(res_step.is_ok)
        self.assertEqual(res_step.status, "success")

        # Missing or non-existent gcode_path returns success
        ctx_missing_path = MagicMock()
        ctx_missing_path.step = getattr(orca.slicing.Step, "psGCodePostProcess", "psGCodePostProcess")
        ctx_missing_path.gcode_path = os.path.join(self.temp_dir.name, "does_not_exist.gcode")
        res_missing = hook.execute(ctx_missing_path)
        self.assertTrue(res_missing.is_ok)
        self.assertEqual(res_missing.status, "success")

    @patch("urllib.request.urlopen")
    def test_is_server_alive(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp
        self.assertTrue(is_server_alive("http://127.0.0.1:3000"))

        mock_urlopen.side_effect = Exception("Connection refused")
        self.assertFalse(is_server_alive("http://127.0.0.1:3000"))

    def test_find_server_components(self):
        runner, script, env = find_server_components()
        # On this environment, electron binary and script or node are located
        if runner and script:
            self.assertTrue(os.path.exists(runner))
            self.assertTrue(os.path.exists(script))

    @patch("subprocess.Popen")
    @patch("prusalapse.plugin.is_server_alive")
    def test_ensure_server_running_and_stop(self, mock_alive, mock_popen):
        import prusalapse.plugin as pl_mod
        pl_mod._SERVER_PROCESS = None

        mock_alive.return_value = False
        mock_proc = MagicMock()
        mock_proc.poll.return_value = None
        mock_popen.return_value = mock_proc

        with patch("prusalapse.plugin.find_server_components", return_value=("node.exe", "server.js", {})):
            started = ensure_server_running("http://127.0.0.1:3000")
            self.assertTrue(started)
            mock_popen.assert_called_once()
            self.assertIsNotNone(pl_mod._SERVER_PROCESS)

            stop_server_process()
            mock_proc.terminate.assert_called_once()
            self.assertIsNone(pl_mod._SERVER_PROCESS)

    @patch("prusalapse.plugin.ensure_server_running")
    def test_on_message_start_server(self, mock_ensure):
        page = PrusaLapsePage(config_path=self.config_path)
        self.assertEqual(mock_ensure.call_count, 1)
        page.on_message({"action": "start_server"})
        self.assertEqual(mock_ensure.call_count, 2)

    def test_plugin_lifecycle(self):
        plugin = PrusaLapsePlugin()
        self.assertEqual(plugin.id, "prusalapse")
        self.assertEqual(plugin.version, "1.3.7")
        self.assertEqual(plugin.author, "Carlos de la Fuente Bustillo")
        with patch("prusalapse.plugin.ensure_server_running") as mock_ensure:
            plugin.on_load()
            mock_ensure.assert_called_once()
        with patch("prusalapse.plugin.stop_server_process") as mock_stop:
            plugin.on_unload()
            mock_stop.assert_called_once()

    def test_pep723_script_metadata(self):
        plugin_path = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "prusalapse", "plugin.py")
        )
        with open(plugin_path, "r", encoding="utf-8") as f:
            content = f.read()

        match = re.search(r"^# /// script\r?\n(.*?)\r?\n# ///", content, re.MULTILINE | re.DOTALL)
        self.assertIsNotNone(match, "PEP 723 script metadata block '# /// script ... # ///' not found")
        block_lines = match.group(1).splitlines()
        toml_lines = []
        for line in block_lines:
            self.assertTrue(line.startswith("#"), f"Line in PEP 723 block does not start with '#': {line}")
            # Strip '#' and optional leading space
            toml_lines.append(line[1:].lstrip(" ") if line.startswith("# ") else line[1:])
        toml_content = "\n".join(toml_lines)

        self.assertIsNotNone(tomllib, "A TOML parser (tomllib or tomli) must be available")
        data = tomllib.loads(toml_content)

        # Root level keys must only contain standard PEP 723 script keys
        self.assertEqual(data.get("requires-python"), ">=3.10")
        self.assertEqual(data.get("dependencies"), [])
        # No redundant root identity keys
        for forbidden in ("name", "version", "author", "authors", "description"):
            self.assertNotIn(forbidden, data, f"Redundant root key '{forbidden}' found in PEP 723 metadata")

        # OrcaSlicer plugin tool table
        self.assertIn("tool", data)
        self.assertIn("orcaslicer", data["tool"])
        self.assertIn("plugin", data["tool"]["orcaslicer"])
        orca_plugin = data["tool"]["orcaslicer"]["plugin"]
        self.assertEqual(orca_plugin.get("name"), "PrusaLapse")
        self.assertEqual(orca_plugin.get("version"), "1.3.7")
        self.assertEqual(orca_plugin.get("author"), "Carlos de la Fuente Bustillo")
        self.assertIn("description", orca_plugin)
        self.assertTrue(len(orca_plugin["description"]) > 10)

    def test_plugin_register_capabilities(self):
        orca.reset_mock()
        plugin = PrusaLapsePlugin()
        self.assertTrue(hasattr(plugin, "register_capabilities"))
        plugin.register_capabilities()

        # Check request_permissions
        self.assertEqual(
            orca.requested_permissions.get("network_http"),
            ["http://127.0.0.1:3000", "http://localhost:3000"],
        )
        self.assertEqual(orca.requested_permissions.get("fs_read"), ["*"])
        self.assertEqual(orca.requested_permissions.get("fs_readwrite"), ["*"])
        self.assertEqual(orca.requested_permissions.get("process"), ["*"])

        # Check registered capabilities
        self.assertIn(PrusaLapsePage, orca.registered_capabilities)
        self.assertIn(PrusaLapseSlicingHook, orca.registered_capabilities)

        # Idempotence: calling again shouldn't fail or duplicate registered capabilities
        plugin.register_capabilities()
        self.assertEqual(orca.registered_capabilities.count(PrusaLapsePage), 1)
        self.assertEqual(orca.registered_capabilities.count(PrusaLapseSlicingHook), 1)

    def test_orca_execution_result_contract(self):
        # Failure result contract
        fail_res = orca.ExecutionResult.failure("custom failure error")
        self.assertEqual(fail_res.status, "failure")
        self.assertEqual(fail_res.message, "custom failure error")
        self.assertFalse(fail_res.is_ok)
        self.assertFalse(bool(fail_res))

        # Success result contract
        ok_res = orca.ExecutionResult.success("success msg")
        self.assertEqual(ok_res.status, "success")
        self.assertEqual(ok_res.message, "success msg")
        self.assertTrue(ok_res.is_ok)
        self.assertTrue(bool(ok_res))

        # Skipped result contract
        skip_res = orca.ExecutionResult.skipped("skip msg")
        self.assertEqual(skip_res.status, "skipped")
        self.assertEqual(skip_res.message, "skip msg")
        self.assertTrue(skip_res.is_ok)

    def test_orca_request_permissions_recording(self):
        orca.request_permissions(
            network_http=["http://127.0.0.1:3000", "http://localhost:3000"],
            fs_read=["*"],
            fs_readwrite=["*"],
            process=["node", "electron"],
        )
        self.assertIn("network_http", orca.requested_permissions)
        self.assertEqual(
            orca.requested_permissions["network_http"],
            ["http://127.0.0.1:3000", "http://localhost:3000"],
        )
        self.assertEqual(orca.requested_permissions["process"], ["node", "electron"])

    def test_orca_register_capability_recording(self):
        class SampleCapability:
            pass

        orca.register_capability(SampleCapability)
        self.assertIn(SampleCapability, orca.registered_capabilities)

    def test_orca_base_register_capabilities_method(self):
        self.assertTrue(hasattr(orca.base, "register_capabilities"))
        base_instance = orca.base()
        self.assertTrue(hasattr(base_instance, "register_capabilities"))
        # Should execute cleanly without raising
        ret = base_instance.register_capabilities()
        self.assertIsNone(ret)


if __name__ == "__main__":
    unittest.main()
