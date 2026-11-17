"""Agent focus regressions. All IPC is mocked; never control live panes.

Run: python3 -m unittest discover -s scripts/tests -p test_hc_agent_focus.py
"""
import contextlib
import importlib.machinery
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

PATH = Path(__file__).resolve().parents[2] / "bin" / "hc-preset"
loader = importlib.machinery.SourceFileLoader("hc_agent_focus_adapter", str(PATH))
spec = importlib.util.spec_from_loader(loader.name, loader)
adapter = importlib.util.module_from_spec(spec)
loader.exec_module(adapter)


class AgentFocusTests(unittest.TestCase):
    def setUp(self):
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.dict(os.environ, {}, clear=True))
        # Use the real resolver with colliding bare IDs, not a mocked resolver
        # that would conceal accidental selection of the local terminal.
        self.world = adapter.HcWorld.__new__(adapter.HcWorld)
        self.world.panes = [
            {"pane_id": "p1", "terminal_id": "t1", "tab_id": "tb1", "workspace_id": "sp1"},
            {"pane_id": "devserver/p1", "terminal_id": "devserver/t1",
             "tab_id": "devserver/tb2", "workspace_id": "devserver/sp2"},
        ]
        for pane in self.world.panes:
            pane.update(cols=80, rows=24)
        self.world.focused_pane_id = "p1"
        self.world.view = {}
        self.world.app_status = {"space": "sp1", "focused_pane": "p1"}
        self.world.term_by_addr = {}
        self.stack.enter_context(patch.object(adapter, "HcWorld", return_value=self.world))
        self.stack.enter_context(patch.object(self.world, "hydrate_pane", side_effect=AssertionError("focus must not hydrate")))
        self.core_rpc = self.stack.enter_context(patch.object(adapter, "hc_rpc", return_value=None))
        self.app_socket = self.stack.enter_context(patch.object(adapter, "herdr_app_socket_path", return_value="/tmp/mocked-agent-focus.sock"))
        self.stack.enter_context(patch.object(adapter, "herdr_app_bin", return_value=None))
        self.native_rpc = self.stack.enter_context(patch.object(adapter, "unix_rpc_line", return_value={"ok": True}))
        self.stack.enter_context(patch.object(adapter.socket, "socket", side_effect=AssertionError("no live IPC")))
        self.stack.enter_context(patch.object(adapter.subprocess, "run", side_effect=AssertionError("no live process")))
        self.stack.enter_context(patch.object(adapter.subprocess, "call", side_effect=AssertionError("no live process")))

    def assert_native_focus(self, terminal):
        self.native_rpc.assert_called_once_with(
            "/tmp/mocked-agent-focus.sock",
            {"do": "agent.focus", "args": {"terminal": terminal}},
            timeout=5.0,
        )
        self.core_rpc.assert_not_called()

    def dispatch(self, args):
        output = io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            status = adapter.main(["--backend", "hc"] + args)
        return status, json.loads(output.getvalue())

    def test_cli_local_and_qualified_remote_pane_and_terminal_ids(self):
        for target, terminal in (("p1", "t1"), ("t1", "t1"),
                                 ("devserver/p1", "devserver/t1"),
                                 ("devserver/t1", "devserver/t1")):
            with self.subTest(target=target):
                self.native_rpc.reset_mock()
                status, reply = self.dispatch(["agent", "focus", target])
                self.assertEqual(status, 0)
                self.assertEqual(reply["result"], {"type": "ok"})
                self.assert_native_focus(terminal)

    def test_rpc_compat_local_and_qualified_remote_ids(self):
        for key in ("target", "pane_id", "terminal"):
            for target, terminal in (("p1", "t1"), ("t1", "t1"),
                                     ("devserver/p1", "devserver/t1"),
                                     ("devserver/t1", "devserver/t1")):
                with self.subTest(key=key, target=target):
                    self.native_rpc.reset_mock()
                    reply = adapter.handle_hc_rpc_compat("agent.focus", {key: target})
                    self.assertEqual(reply["result"], {"type": "ok"})
                    self.assert_native_focus(terminal)

    def test_rpc_cli_dispatch_uses_native_agent_focus(self):
        for target, terminal in (("t1", "t1"), ("devserver/t1", "devserver/t1")):
            with self.subTest(target=target):
                self.native_rpc.reset_mock()
                status, reply = self.dispatch(["rpc", "agent.focus", json.dumps({"target": target})])
                self.assertEqual(status, 0)
                self.assertEqual(reply["result"], {"type": "ok"})
                self.assert_native_focus(terminal)

    def test_remote_is_selected_even_when_panes_are_reversed(self):
        self.world.panes.reverse()
        for target, terminal in (("t1", "t1"), ("devserver/t1", "devserver/t1")):
            with self.subTest(target=target):
                self.native_rpc.reset_mock()
                adapter.handle_hc_rpc_compat("agent.focus", {"target": target})
                self.assert_native_focus(terminal)

    def test_remote_source_layout_and_cli_rpc_close_are_exact_in_both_orders(self):
        for reverse in (False, True):
            if reverse:
                self.world.panes.reverse()
            for target in ("devserver/p1", "devserver/t1"):
                with self.subTest(reverse=reverse, target=target), \
                        patch.object(self.world, "hydrate_pane", side_effect=lambda p: p):
                    status, reply = self.dispatch(["pane", "layout", "--pane", target])
                    self.assertEqual(status, 0)
                    self.assertEqual(reply["result"]["layout"]["tab_id"], "devserver/tb2")
                    for args in (["pane", "close", target],
                                 ["rpc", "pane.close", json.dumps({"pane_id": target})]):
                        self.native_rpc.reset_mock()
                        status, reply = self.dispatch(args)
                        self.assertEqual(status, 0)
                        self.assertEqual(reply["result"], {"type": "ok"})
                        self.native_rpc.assert_called_once_with(
                            "/tmp/mocked-agent-focus.sock",
                            {"do": "pane.close", "args": {"pane": "devserver/p1"}}, timeout=5.0,
                        )
        self.core_rpc.assert_not_called()

    def test_absent_qualified_source_never_aliases_local_pane_or_terminal(self):
        self.world.panes = self.world.panes[:1]
        for target in ("devserver/p1", "devserver/t1"):
            for args in (["pane", "layout", "--pane", target], ["pane", "close", target],
                         ["rpc", "pane.close", json.dumps({"pane_id": target})],
                         ["agent", "focus", target]):
                with self.subTest(args=args):
                    status, reply = self.dispatch(args)
                    self.assertEqual(status, 1)
                    self.assertIn("error", reply)
        self.native_rpc.assert_not_called()
        self.assertTrue(all(call.args == ("terminal.get", {"terminal": call.args[1]["terminal"]})
                            and call.args[1]["terminal"].startswith("devserver/")
                            for call in self.core_rpc.call_args_list))

    def test_current_environment_resolution_prefers_exact_remote_match(self):
        with patch.dict(os.environ, {"HERDR_ACTIVE_PANE_ID": "devserver/p1"}):
            self.assertEqual(self.world.resolve_pane(None, hydrate=False)["terminal_id"], "devserver/t1")

    def test_headless_remote_alias_remains_supported(self):
        self.app_socket.return_value = None
        self.world.app_status = {}
        self.world.panes = self.world.panes[:1]
        self.assertEqual(self.world.resolve_pane("devserver/t1", hydrate=False)["terminal_id"], "t1")
        self.core_rpc.assert_not_called()

    def test_fetched_remote_terminal_keeps_machine_qualification(self):
        self.world.panes = self.world.panes[:1]
        self.core_rpc.return_value = {"result": {"address": "t1", "labels": {}}}
        with patch.object(self.world, "_build_pane", return_value={"terminal_id": "devserver/t1"}) as build:
            pane = self.world.resolve_pane("devserver/t1", hydrate=False)
            self.assertEqual(pane["terminal_id"], "devserver/t1")
            self.assertEqual(build.call_args.kwargs["t_addr"], "devserver/t1")
            self.assertEqual(build.call_args.kwargs["p_id"], "devserver/t1")

    def test_current_target_preserves_resolver_default(self):
        status, reply = self.dispatch(["agent", "focus"])
        self.assertEqual(status, 0)
        self.assertEqual(reply["result"], {"type": "ok"})
        self.assert_native_focus("t1")

    def test_headless_cli_and_rpc_are_noops_not_errors(self):
        self.app_socket.return_value = None
        for target in ("t1", "devserver/t1"):
            for args in (["agent", "focus", target],
                         ["rpc", "agent.focus", json.dumps({"target": target})]):
                with self.subTest(args=args):
                    status, reply = self.dispatch(args)
                    self.assertEqual(status, 0)
                    self.assertEqual(reply["result"], {"type": "ok"})
        self.assertIsNone(adapter.herdr_app_do("agent.focus", {"terminal": "devserver/t1"}))
        self.native_rpc.assert_not_called()
        self.core_rpc.assert_not_called()

    def test_missing_target_is_an_error_without_native_mutation(self):
        for args in (["agent", "focus", "missing"],
                     ["rpc", "agent.focus", '{"target":"missing"}']):
            with self.subTest(args=args):
                status, reply = self.dispatch(args)
                self.assertEqual(status, 1)
                self.assertEqual(reply["error"]["code"], "agent_not_found")
        self.native_rpc.assert_not_called()

    def test_confirmation_popup_preserves_custom_window_home_and_remote_target(self):
        self.world.panes[1]["machine"] = "devserver"
        with tempfile.TemporaryDirectory(prefix="custom app home ") as app_home, \
                patch.dict(os.environ, {"HERDR_APP_HOME": app_home, "HERDR_ACTIVE_PANE_ID": "devserver/p1"}), \
                patch.object(adapter, "resolve_plugin_entrypoint_command", return_value="/bin/true"), \
                patch.object(self.world, "hydrate_pane", side_effect=lambda p: p), \
                patch.object(adapter, "hc_bin", return_value="/bin/hc"), \
                patch.object(adapter, "save_json_file"), \
                patch.object(adapter.subprocess, "run", return_value=Mock(returncode=0, stdout='{"address":"popup"}')) as launch, \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(adapter.handle_popup_open("hc", "confirm-close", "confirm", "64", "9",
                                                      ["ASCONFIRMCLOSE_PANE_ID=devserver/p1"]), 0)
            args = launch.call_args.args[0]
            self.assertNotIn("--on", args)
            self.assertIn("HERDR_APP_HOME=" + adapter.shlex.quote(app_home), args[-1])
            self.assertIn("ASCONFIRMCLOSE_PANE_ID=devserver/p1", args[-1])

    def test_window_missing_reply_or_native_error_does_not_silently_succeed(self):
        for reply in (None, {"error": "no such agent"}):
            with self.subTest(reply=reply):
                self.native_rpc.return_value = reply
                with self.assertRaises(adapter.AdapterError):
                    adapter.handle_hc_rpc_compat("agent.focus", {"target": "devserver/t1"})


if __name__ == "__main__":
    unittest.main()
