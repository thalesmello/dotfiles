"""Adapter regression tests. Mock all IPC/process calls; never control live panes.

Run: python3 -m unittest discover -s scripts/tests -p test_hc_preset.py
"""
import contextlib
import importlib.machinery
import importlib.util
import io
import os
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

PATH = Path(__file__).resolve().parents[2] / "bin" / "hc-preset"
loader = importlib.machinery.SourceFileLoader("hc_preset", str(PATH))
spec = importlib.util.spec_from_loader(loader.name, loader)
adapter = importlib.util.module_from_spec(spec)
loader.exec_module(adapter)


class BackendTests(unittest.TestCase):
    def test_legacy_plugin_socket_beats_frontmost_app(self):
        with patch.dict(os.environ, {"HERDR_SOCKET_PATH": "/tmp/legacy.sock"}, clear=True), \
                patch.object(adapter, "herdr_app_socket_path", side_effect=AssertionError("must not guess")):
            self.assertEqual(adapter.detect_backend(), "herdr")

    def test_legacy_keybinding_beats_inherited_core_context(self):
        env = {"HERDR_SOCKET_PATH": "/tmp/legacy.sock", "HERDR_ENV": "1",
               "HERDR_ACTIVE_PANE_ID": "w1:p1", "HC_TERMINAL_ID": "t3", "TERM_PROGRAM": "ghostty"}
        with patch.dict(os.environ, env, clear=True):
            self.assertEqual(adapter.detect_backend(), "herdr")

    def test_core_helper_explicit_override_beats_compatibility_markers(self):
        env = {"HC_PRESET_BACKEND": "hc", "HERDR_ACTIVE_PANE_ID": "p123", "HC_TERMINAL_ID": "t3"}
        with patch.dict(os.environ, env, clear=True):
            self.assertEqual(adapter.detect_backend(), "hc")
            self.assertEqual(adapter.detect_backend("herdr"), "herdr")

    def test_core_terminal(self):
        with patch.dict(os.environ, {"HC_TERMINAL_ID": "t3"}, clear=True):
            self.assertEqual(adapter.detect_backend(), "hc")

    def test_explicit_sockets_do_not_fall_back(self):
        env = {"HERDR_SOCKET_PATH": "/missing/herdr.sock", "HC_SOCKET": "/missing/core.sock"}
        with patch.dict(os.environ, env, clear=True):
            self.assertEqual(adapter.herdr_socket_path(), env["HERDR_SOCKET_PATH"])
            self.assertEqual(adapter.hc_socket_path(), env["HC_SOCKET"])

    def test_named_core_session_does_not_fall_back_to_default(self):
        with patch.dict(os.environ, {"HC_SESSION": "named"}, clear=True), \
                patch.object(adapter.os.path, "exists", side_effect=lambda p: "/default/" in p):
            self.assertIsNone(adapter.hc_socket_path())

    def test_legacy_cli_arguments_preserved(self):
        with patch.object(adapter, "herdr_bin", return_value="/bin/herdr"), \
                patch.object(adapter.subprocess, "call", return_value=0) as call:
            self.assertEqual(adapter.main(["--backend", "herdr", "--session", "named", "pane", "list"]), 0)
            call.assert_called_once_with(["/bin/herdr", "--session", "named", "pane", "list"])


class ErrorTests(unittest.TestCase):
    def test_json_error_is_nonzero(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(adapter.print_json({"error": {"code": "test"}}), 1)
            self.assertEqual(adapter.print_json({"result": {"type": "ok"}}), 0)

    def test_failed_core_mutation_raises(self):
        with patch.object(adapter, "hc_socket_path", return_value="/tmp/core.sock"), \
                patch.object(adapter, "unix_rpc_line", return_value={"error": {"kind": "blocked"}}):
            with self.assertRaises(adapter.AdapterError):
                adapter.hc_rpc("terminal.send", {"terminal": "t3", "text": "hello"})

    def test_missing_core_mutation_reply_raises(self):
        with patch.object(adapter, "hc_socket_path", return_value=None):
            with self.assertRaises(adapter.AdapterError):
                adapter.hc_rpc("doc.set", {})

    def test_failed_app_focus_raises(self):
        with patch.object(adapter, "herdr_app_rpc", return_value={"error": "no such pane"}):
            with self.assertRaises(adapter.AdapterError):
                adapter.herdr_app_do("pane.focus", {"pane": "missing"})

    def test_missing_app_reply_is_not_retried_after_mutation(self):
        with patch.object(adapter, "herdr_app_socket_path", return_value="/tmp/app.sock"), \
                patch.object(adapter, "unix_rpc_line", return_value=None), \
                patch.object(adapter.subprocess, "run") as run:
            with self.assertRaises(adapter.AdapterError):
                adapter.herdr_app_do("tab.new", {"name": "tests"})
            run.assert_not_called()

    def test_unknown_rpc_and_split_ratio_are_not_success(self):
        with patch.object(adapter, "HcWorld", return_value=Mock()):
            for method in ("missing.method", "layout.set_split_ratio", "layout.export"):
                self.assertIn("error", adapter.handle_hc_rpc_compat(method, {}))

    def test_stale_metadata_target_is_not_success(self):
        world = Mock()
        world.resolve_pane.return_value = None
        with patch.object(adapter, "HcWorld", return_value=world):
            for method in ("pane.report_metadata", "pane.report_agent", "pane.report_agent_session"):
                self.assertEqual(adapter.handle_hc_rpc_compat(method, {"pane_id": "missing"})["error"]["code"], "pane_not_found")

    def test_rpc_cli_exits_nonzero_for_server_error(self):
        with patch.object(adapter, "herdr_rpc", return_value={"error": {"code": "missing"}}), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(adapter.main(["--backend", "herdr", "rpc", "pane.focus", "{}"]), 1)

    def test_error_status_maps_to_blocked(self):
        world = adapter.HcWorld.__new__(adapter.HcWorld)
        world.view = {}
        world.focused_pane_id = None
        world.term_by_addr = {
            "t1": {"address": "t1", "agent": "pi", "status": "error", "cwd": "/tmp", "labels": {}},
            "t2": {"address": "t2", "agent": "pi", "status": {"state": "error", "msg": "API error"}, "cwd": "/tmp", "labels": {}},
        }
        p1 = world._build_pane("p1", "t1", "tb1", "ws1", 0, {"terminal": "t1", "pane": "p1"})
        p2 = world._build_pane("p2", "t2", "tb1", "ws1", 1, {"terminal": "t2", "pane": "p2"})
        self.assertEqual(p1["agent_status"], "blocked")
        self.assertEqual(p2["agent_status"], "blocked")

    def test_print_json_is_compact_for_sed_parsers(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            adapter.print_json({"result": {"pane": {"pane_id": "p123"}}})
        self.assertIn('"pane_id":"p123"', buf.getvalue())

    def test_do_space_new_inherits_focused_cwd_and_machine(self):
        world = Mock()
        world.resolve_pane.return_value = {"foreground_cwd": "/Users/test/src/repo", "cwd": "/Users/test"}
        world.workspaces = [{"workspace_id": "ws1", "focused": True, "machine": "devserver", "cwd": "/Users/test"}]
        with patch.object(adapter, "HcWorld", return_value=world), \
                patch.object(adapter, "herdr_app_do", return_value={"space": "sp2"}) as do_mock, \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(adapter.main(["--backend", "hc", "do", "space.new"]), 0)
            do_mock.assert_called_once_with(
                "space.new",
                {"machine": "devserver", "folder": "/Users/test/src/repo"},
            )

    def test_popup_open_exports_extra_env_and_prints_result(self):
        world = Mock()
        world.resolve_pane.return_value = {
            "pane_id": "p1",
            "tab_id": "tb1",
            "workspace_id": "ws1",
            "terminal_id": "t1",
            "foreground_cwd": "/tmp",
            "cwd": "/tmp",
        }
        proc_res = Mock(returncode=0, stdout='{"address":"t99"}')
        buf = io.StringIO()
        with patch.object(adapter, "resolve_plugin_entrypoint_command", return_value="/bin/true"), \
                patch.object(adapter, "HcWorld", return_value=world), \
                patch.object(adapter, "hc_bin", return_value="/bin/hc"), \
                patch.object(adapter.subprocess, "run", return_value=proc_res) as run_mock, \
                patch.object(adapter, "save_json_file"), \
                patch.object(adapter, "herdr_app_do", return_value={"ok": True}), \
                contextlib.redirect_stdout(buf):
            rc = adapter.handle_popup_open("hc", "confirm-close", "confirm", "64", "9", ["ASCONFIRMCLOSE_PANE_ID=p1"])
        self.assertEqual(rc, 0)
        self.assertIn('"pane_id":"t99"', buf.getvalue())
        cmd_line = run_mock.call_args[0][0][-1]
        self.assertIn("ASCONFIRMCLOSE_PANE_ID=p1", cmd_line)

    def test_fast_pane_visible_unwrap_uses_terminal_get_and_read(self):
        env = {"HERDR_ACTIVE_PANE_ID": "p1", "HERDR_ACTIVE_TERMINAL_ID": "t19"}
        t_resp = {"result": {"cols": 20, "foreground": {"name": "pi"}}}
        r_resp = {"result": {"text": "01234567890123456789\n/foo/bar rest\n"}}
        buf = io.StringIO()
        with patch.dict(os.environ, env, clear=True), \
                patch.object(adapter, "hc_rpc", side_effect=[t_resp, r_resp]) as rpc_mock, \
                contextlib.redirect_stdout(buf):
            rc = adapter.fast_hc_pane_visible_unwrap(["p1"])
        self.assertEqual(rc, 0)
        self.assertEqual(buf.getvalue(), "01234567890123456789/foo/bar\nrest\n")
        self.assertEqual(rpc_mock.call_count, 2)


if __name__ == "__main__":
    unittest.main()
