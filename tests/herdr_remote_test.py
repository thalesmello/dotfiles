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
from unittest.mock import patch

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
                "--split", "right",
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
            "mode": "split",
            "direction": "right",
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
