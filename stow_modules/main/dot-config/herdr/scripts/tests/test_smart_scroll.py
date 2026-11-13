"""Tests for scripts/smart-scroll.sh."""

from importlib.machinery import SourceFileLoader
import importlib.util
import io
import os
import sys
import unittest
from unittest import mock

_HERE = os.path.dirname(os.path.abspath(__file__))
_SCRIPT = os.path.join(_HERE, "..", "smart-scroll.sh")
_loader = SourceFileLoader("smart_scroll", _SCRIPT)
_spec = importlib.util.spec_from_loader("smart_scroll", _loader)
ss = importlib.util.module_from_spec(_spec)
sys.modules["smart_scroll"] = ss
_spec.loader.exec_module(ss)


class SmartScrollHerdrTest(unittest.TestCase):
    def test_shell_pane_scrolls_to_top_and_bottom(self):
        calls = []

        def fake_rpc(_sock, payload, timeout=1.5):
            calls.append(payload)
            if payload.get("method") == "pane.get":
                return {
                    "result": {
                        "pane": {
                            "pane_id": "w1:p1",
                            "agent": None,
                            "terminal_title": "fish ~/src",
                            "scroll": {"max_offset_from_bottom": 42, "offset_from_bottom": 0},
                        }
                    }
                }
            return {"result": {}}

        with mock.patch.object(ss, "find_herdr_socket", return_value="/tmp/fake.sock"), \
             mock.patch.object(ss, "rpc_line", side_effect=fake_rpc), \
             mock.patch.dict(os.environ, {"HERDR_ACTIVE_PANE_ID": "w1:p1"}, clear=False):
            self.assertEqual(ss.handle_herdr(True), 0)
            self.assertEqual(ss.handle_herdr(False), 0)

        self.assertEqual(calls[1]["method"], "pane.scroll")
        self.assertEqual(calls[1]["params"], {"pane_id": "w1:p1", "offset_from_bottom": 18446744073709551615})
        self.assertEqual(calls[3]["method"], "pane.scroll")
        self.assertEqual(calls[3]["params"], {"pane_id": "w1:p1", "offset_from_bottom": 0})

    def test_pi_agent_pane_forwards_super_up_and_down(self):
        calls = []

        def fake_rpc(_sock, payload, timeout=1.5):
            calls.append(payload)
            if payload.get("method") == "pane.get":
                return {
                    "result": {
                        "pane": {
                            "pane_id": "w1:p2",
                            "agent": "pi",
                            "terminal_title": "Session Title",
                            "scroll": {"max_offset_from_bottom": 0, "offset_from_bottom": 0},
                        }
                    }
                }
            return {"result": {}}

        with mock.patch.object(ss, "find_herdr_socket", return_value="/tmp/fake.sock"), \
             mock.patch.object(ss, "rpc_line", side_effect=fake_rpc), \
             mock.patch.dict(os.environ, {"HERDR_ACTIVE_PANE_ID": "w1:p2"}, clear=False):
            self.assertEqual(ss.handle_herdr(True), 0)
            self.assertEqual(ss.handle_herdr(False), 0)

        self.assertEqual(calls[1]["method"], "pane.send_keys")
        self.assertEqual(calls[1]["params"], {"pane_id": "w1:p2", "keys": ["super+up"]})
        self.assertEqual(calls[3]["method"], "pane.send_keys")
        self.assertEqual(calls[3]["params"], {"pane_id": "w1:p2", "keys": ["super+down"]})

    def test_nested_herdr_title_forwards_keys(self):
        calls = []

        def fake_rpc(_sock, payload, timeout=1.5):
            calls.append(payload)
            if payload.get("method") == "pane.get":
                return {
                    "result": {
                        "pane": {
                            "pane_id": "w1:p3",
                            "agent": None,
                            "terminal_title": "[et] [herdr] devvm: qq",
                            "scroll": {"max_offset_from_bottom": 0, "offset_from_bottom": 0},
                        }
                    }
                }
            return {"result": {}}

        with mock.patch.object(ss, "find_herdr_socket", return_value="/tmp/fake.sock"), \
             mock.patch.object(ss, "rpc_line", side_effect=fake_rpc), \
             mock.patch.dict(os.environ, {"HERDR_ACTIVE_PANE_ID": "w1:p3"}, clear=False):
            self.assertEqual(ss.handle_herdr(True), 0)

        self.assertEqual(calls[1]["method"], "pane.send_keys")
        self.assertEqual(calls[1]["params"], {"pane_id": "w1:p3", "keys": ["super+up"]})


class SmartScrollHcTest(unittest.TestCase):
    def test_hc_shell_pane_scrolls_terminal(self):
        calls = []

        def fake_rpc(_sock, payload, timeout=1.5):
            calls.append(payload)
            if payload.get("status"):
                return {"agent": None, "focused_pane": "p1", "overlays": []}
            if payload.get("ls"):
                return {"spaces": [{"tabs": [{"terminals": [{"pane": "p1", "terminal": "t1", "app": None}]}]}]}
            if payload.get("method") == "terminal.get":
                return {"result": {"foreground": {"name": "fish"}, "title": "fish ~/src"}}
            return {}

        buf = io.StringIO()
        with mock.patch.object(ss, "find_herdr_app_socket", return_value="/tmp/app.sock"), \
             mock.patch.object(ss, "find_hc_socket", return_value="/tmp/hc.sock"), \
             mock.patch.object(ss, "rpc_line", side_effect=fake_rpc), \
             mock.patch.object(sys, "stdout", buf):
            self.assertEqual(ss.handle_hc(True), 0)
            self.assertEqual(ss.handle_hc(False), 0)

        self.assertEqual(buf.getvalue(), "")
        scroll_calls = [c for c in calls if "do" in c]
        self.assertEqual(scroll_calls, [
            {"do": "terminal.scroll", "args": {"to": "top"}},
            {"do": "terminal.scroll", "args": {"to": "bottom"}},
        ])

    def test_hc_agent_pane_outputs_forward(self):
        def fake_rpc(_sock, payload, timeout=1.5):
            if payload.get("status"):
                return {"agent": "t19", "focused_pane": "p19", "overlays": []}
            return {}

        buf = io.StringIO()
        with mock.patch.object(ss, "find_herdr_app_socket", return_value="/tmp/app.sock"), \
             mock.patch.object(ss, "rpc_line", side_effect=fake_rpc), \
             mock.patch.object(sys, "stdout", buf):
            self.assertEqual(ss.handle_hc(True), 0)

        self.assertEqual(buf.getvalue().strip(), "forward")


if __name__ == "__main__":
    unittest.main()
