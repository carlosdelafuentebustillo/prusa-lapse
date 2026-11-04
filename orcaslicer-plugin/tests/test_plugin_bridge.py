import io
import json
import os
import sys
import tempfile
import unittest
from unittest.mock import patch, MagicMock

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
        self.assertEqual(plugin.version, "1.3.2")
        with patch("prusalapse.plugin.ensure_server_running") as mock_ensure:
            plugin.on_load()
            mock_ensure.assert_called_once()
        with patch("prusalapse.plugin.stop_server_process") as mock_stop:
            plugin.on_unload()
            mock_stop.assert_called_once()


if __name__ == "__main__":
    unittest.main()
