"""Offline unit tests for bin/herdr-remote.

Run: python3 -m unittest tests/herdr_remote_test.py
"""

import base64
import importlib.machinery
import importlib.util
import io
import json
import os
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, Mock, MagicMock
from types import SimpleNamespace
import copy

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "bin/herdr-remote"
LUA_MOD = ROOT / "stow_modules/main/dot-hammerspoon/herdrAction.lua"

loader = importlib.machinery.SourceFileLoader("herdr_remote", str(SCRIPT))
spec = importlib.util.spec_from_loader(loader.name, loader)
mod = importlib.util.module_from_spec(spec)
loader.exec_module(mod)


class HerdrRemoteTests(unittest.TestCase):
    def test_namespace_matches_lua_module(self):
        lua_text = LUA_MOD.read_text(encoding="utf-8")
        expected = f'M.RELAY_PREFIX = "\\30{mod.VERSION}:{mod.NAMESPACE}:"'
        self.assertIn(expected, lua_text)

    def test_attach_explicit_machine_and_split(self):
        out = io.StringIO()
        with patch("sys.stdout", out):
            rc = mod.main([
                "attach", "devserver/t5j",
                "--split", "down",
                "--pane", "devserver/p1",
                "--space", "my-ws",
                "--name", "logs",
                "--no-focus",
                "--dry-run",
            ])
        self.assertEqual(rc, 0)
        payload = json.loads(out.getvalue())
        self.assertEqual(payload, {
            "action": "attach",
            "terminal": "t5j",
            "machine": "devserver",
            "mode": "split",
            "direction": "down",
            "pane": "devserver/p1",
            "space": "my-ws",
            "name": "logs",
            "focus": False,
        })

    def test_attach_auto_discovers_terminal_and_core_id(self):
        with tempfile.TemporaryDirectory() as tmp:
            core_dir = Path(tmp) / "herdr-core/default"
            core_dir.mkdir(parents=True)
            (core_dir / "core.json").write_text('{"id":"DeadBeef01"}\n', encoding="utf-8")

            env = {
                "XDG_STATE_HOME": tmp,
                "HC_TERMINAL_ID": "t9z",
            }
            out = io.StringIO()
            with patch.dict(os.environ, env, clear=True), patch("sys.stdout", out):
                rc = mod.main(["attach", "--dry-run"])
            self.assertEqual(rc, 0)
            payload = json.loads(out.getvalue())
            self.assertEqual(payload, {
                "action": "attach",
                "terminal": "t9z",
                "core_id": "deadbeef01",
                "mode": "tab",
            })

    def test_run_local_command_dry_run(self):
        out = io.StringIO()
        with patch("sys.stdout", out):
            rc = mod.main([
                "run",
                "--tab",
                "--space", "mac-tools",
                "--folder", "~/src",
                "--dry-run",
                "--",
                "python3", "-c", "print('hi')",
            ])
        self.assertEqual(rc, 0)
        payload = json.loads(out.getvalue())
        self.assertEqual(payload, {
            "action": "local.run",
            "argv": ["python3", "-c", "print('hi')"],
            "folder": "~/src",
            "mode": "tab",
            "space": "mac-tools",
        })

    def test_osc52_framing_roundtrip(self):
        with tempfile.NamedTemporaryFile(mode="r+", encoding="utf-8") as tty:
            with patch.object(mod, "resolve_tty", return_value=tty.name):
                rc = mod.main(["attach", "devserver/t5j", "--space", "eng"])
            self.assertEqual(rc, 0)
            tty.seek(0)
            wire = tty.read()

        m = re.fullmatch(r"\033\]52;c;([A-Za-z0-9+/=]+)\007", wire)
        self.assertIsNotNone(m)
        record = base64.b64decode(m.group(1)).decode("utf-8")
        prefix = f"\x1e{mod.VERSION}:{mod.NAMESPACE}:"
        self.assertTrue(record.startswith(prefix))
        self.assertTrue(record.endswith("\x1f"))
        body_b64 = record[len(prefix):-1]
        decoded = json.loads(base64.b64decode(body_b64).decode("utf-8"))
        self.assertEqual(decoded, {
            "action": "attach",
            "terminal": "t5j",
            "machine": "devserver",
            "mode": "tab",
            "space": "eng",
        })

    def test_navigation_payloads(self):
        actions = {"focus": "focus", "select-space": "space.select",
                   "select-tab": "tab.select", "zoom": "pane.zoom"}
        for command, action in actions.items():
            out = io.StringIO()
            with patch("sys.stdout", out):
                mod.main([command, "devserver/p1", "--dry-run"])
            self.assertEqual(json.loads(out.getvalue()),
                             {"action": action, "target": "devserver/p1"})

    def test_local_run_requires_workspace(self):
        with patch("sys.stderr", io.StringIO()), self.assertRaises(SystemExit):
            mod.main(["run", "--dry-run", "--", "echo", "hello"])

    def test_listing_socket_roundtrip_and_cleanup(self):
        paths = []

        def reply(record):
            body = record.split(":", 2)[2][:-1]
            request = json.loads(base64.b64decode(body))
            route = request["reply"]
            paths.append(route["socket"])
            self.assertEqual(request["kind"], "workspaces")
            self.assertEqual(os.stat(os.path.dirname(route["socket"])).st_mode & 0o777, 0o700)
            with mod.socket.socket(mod.socket.AF_UNIX, mod.socket.SOCK_STREAM) as client:
                client.connect(route["socket"])
                client.sendall(route["nonce"].encode() + b'\n{"workspaces":[]}')

        out = io.StringIO()
        with patch.object(mod, "hc_core_id", return_value="deadbeef"), \
                patch.object(mod, "emit_osc52", side_effect=reply), patch("sys.stdout", out):
            self.assertEqual(mod.main(["list", "workspaces"]), 0)
        self.assertEqual(json.loads(out.getvalue()), {"workspaces": []})
        self.assertFalse(os.path.exists(paths[0]))

    def test_listing_rejects_wrong_nonce(self):
        def reply(record):
            request = json.loads(base64.b64decode(record.split(":", 2)[2][:-1]))
            with mod.socket.socket(mod.socket.AF_UNIX, mod.socket.SOCK_STREAM) as client:
                client.connect(request["reply"]["socket"])
                client.sendall(b'wrong\n{}')
        with patch.object(mod, "hc_core_id", return_value="deadbeef"), \
                patch.object(mod, "emit_osc52", side_effect=reply), \
                patch("sys.stderr", io.StringIO()), self.assertRaises(SystemExit):
            mod.main(["list", "tabs"])

    def move_fixture(self):
        return {"spaces": [
            {"id": "sp1", "tabs": [{"id": "tb1", "root": {"type": "row", "children": [
                {"id": "p1", "type": "block", "size": {"weight": 2}, "content": {"terminal": "t1"}},
                {"id": "p2", "type": "block", "content": {"terminal": "t2"}},
            ]}}]},
            {"id": "sp2", "tabs": [{"id": "tb2", "root": {
                "id": "p3", "type": "block", "content": {"terminal": "t3"}}}]},
        ]}

    def test_move_preserves_identity_and_input_document(self):
        doc = self.move_fixture()
        original = copy.deepcopy(doc)
        changed, tab = mod.move_document(doc, "p1", "t1", "sp2", "tb2")
        self.assertEqual(doc, original)
        self.assertEqual(tab, "tb2")
        self.assertEqual(changed["spaces"][0]["tabs"][0]["root"]["children"][0]["id"], "p2")
        moved = changed["spaces"][1]["tabs"][0]["root"]["children"][1]
        self.assertEqual(moved["id"], "p1")
        self.assertEqual(moved["content"]["terminal"], "t1")
        self.assertNotIn("size", moved)

    def test_move_new_tab_and_last_pane_removal(self):
        doc = self.move_fixture()
        changed, tab = mod.move_document(doc, "p3", "t3", "sp1", name="moved")
        self.assertEqual(len(changed["spaces"]), 1)
        new_tab = changed["spaces"][0]["tabs"][-1]
        self.assertEqual(new_tab["id"], tab)
        self.assertEqual(new_tab["name"], "moved")
        self.assertEqual(new_tab["root"]["children"][0]["id"], "p3")

    def test_move_rejects_stale_or_ambiguous_targets(self):
        for pane, terminal, space, tab in [
            ("gone", "t1", "sp2", None), ("p1", "wrong", "sp2", None),
            ("p1", "t1", "missing", None), ("p1", "t1", "sp1", "tb1"),
            ("p1", "t1", "sp2", "missing"),
        ]:
            with self.subTest(pane=pane, space=space), self.assertRaises(ValueError):
                mod.move_document(self.move_fixture(), pane, terminal, space, tab)

    def test_move_uses_versioned_write_and_does_not_retry_conflict(self):
        layout = {"spaces": [
            {"id": "sp1", "tabs": [{"terminals": [{"pane": "p1", "terminal": "t1"}]}]},
            {"id": "sp2", "tabs": []},
        ]}
        def checked(reply, _):
            return reply
        def rpc(method, params):
            if method == "doc.get":
                return {"result": {"value": self.move_fixture(), "version": 7}}
            if method == "doc.set":
                self.assertEqual(params["version"], 7)
                raise RuntimeError("version conflict")
            self.fail("unexpected mutation: " + method)
        adapter = SimpleNamespace(herdr_app_rpc=Mock(return_value=layout),
                                  hc_rpc=Mock(side_effect=rpc), require_reply=checked)
        with patch.object(mod, "load_core_adapter", return_value=adapter), self.assertRaises(RuntimeError):
            mod.move_on_mac("p1", "sp2", None, "moved", "t1")
        self.assertEqual([c.args[0] for c in adapter.hc_rpc.call_args_list], ["doc.get", "doc.set"])

    def test_move_rejects_cross_machine_before_mutation(self):
        layout = {"spaces": [
            {"id": "sp1", "tabs": [{"terminals": [{"pane": "p1", "terminal": "t1"}]}]},
            {"id": "devserver/sp2", "machine": "devserver", "tabs": []},
        ]}
        adapter = SimpleNamespace(herdr_app_rpc=Mock(return_value=layout), hc_rpc=Mock(),
                                  require_reply=lambda reply, _: reply)
        with patch.object(mod, "load_core_adapter", return_value=adapter), self.assertRaises(ValueError):
            mod.move_on_mac("p1", "devserver/sp2", None, "moved", "t1")
        adapter.hc_rpc.assert_not_called()

    def test_remote_move_routes_document_and_labels_to_same_machine(self):
        layout = {"spaces": [
            {"id": "dev/sp1", "machine": "dev", "tabs": [{"terminals": [{"pane": "dev/p1", "terminal": "dev/t1"}]}]},
            {"id": "dev/sp2", "machine": "dev", "tabs": []},
        ]}
        def rpc(method, params):
            if method == "doc.get":
                self.assertEqual(params, {"name": "herdr-app", "on": "dev"})
                return {"result": {"value": self.move_fixture(), "version": 7}}
            if method == "doc.set":
                self.assertEqual(params["on"], "dev")
                self.assertEqual(params["version"], 7)
            if method == "terminal.label":
                self.assertEqual(params["terminal"], "dev/t1")
                self.assertEqual(params["labels"]["herdr.space"], "sp2")
            return {"result": {}}
        adapter = SimpleNamespace(herdr_app_rpc=Mock(return_value=layout), hc_rpc=Mock(side_effect=rpc),
                                  require_reply=lambda reply, _: reply)
        out = io.StringIO()
        with patch.object(mod, "load_core_adapter", return_value=adapter), patch("sys.stdout", out):
            self.assertEqual(mod.move_on_mac("dev/p1", "dev/sp2", None, "moved", "dev/t1"), 0)
        result = json.loads(out.getvalue())
        self.assertEqual(result["terminal"], "dev/t1")
        self.assertTrue(result["tab"].startswith("dev/tb"))

    def test_listing_timeout_is_bounded_and_reported(self):
        server = MagicMock()
        server.__enter__.return_value = server
        server.accept.side_effect = mod.socket.timeout("timed out")
        err = io.StringIO()
        with patch.object(mod.socket, "socket", return_value=server), \
                patch.object(mod, "hc_core_id", return_value="deadbeef"), \
                patch.object(mod, "emit_osc52"), patch("sys.stderr", err), self.assertRaises(SystemExit):
            mod.main(["list", "tabs"])
        server.settimeout.assert_called_with(20)
        self.assertIn("timed out", err.getvalue())

    def test_reply_delivery_failure_has_no_traceback(self):
        err = io.StringIO()
        with patch("sys.stderr", err), self.assertRaises(SystemExit):
            mod.main(["--deliver-reply", "/nonexistent/reply.sock", "a" * 32])
        self.assertIn("reply delivery failed", err.getvalue())

    def test_rejects_invalid_inputs(self):
        bad_invocations = [
            ["attach", "--machine", "--bad", "t1", "--dry-run"],
            ["attach", "devserver/t1;id", "--dry-run"],
            ["attach", "--machine", "other", "devserver/t1", "--dry-run"],
            ["attach", "devserver/t1", "--pane", "--evil", "--dry-run"],
            ["attach", "devserver/t1", "--space", "bad\nws", "--dry-run"],
            ["run", "--dry-run", "--"],
            ["run", "--folder", "/tmp/../etc", "--dry-run", "--", "ls"],
            ["run", "--folder", "relative", "--dry-run", "--", "ls"],
        ]
        for argv in bad_invocations:
            with self.subTest(argv=argv), patch("sys.stderr", io.StringIO()):
                with self.assertRaises(SystemExit) as ctx:
                    mod.main(argv)
                self.assertEqual(ctx.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
