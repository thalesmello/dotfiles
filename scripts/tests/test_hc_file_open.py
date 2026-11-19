"""Direct editor-launch regressions. All IPC is mocked; no live panes touched.

Run: python3 -m unittest discover -s scripts/tests -p test_hc_file_open.py
"""
import contextlib
import copy
import importlib.machinery
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
loader = importlib.machinery.SourceFileLoader("hc_file_open_adapter", str(ROOT / "bin/hc-preset"))
spec = importlib.util.spec_from_loader(loader.name, loader)
adapter = importlib.util.module_from_spec(spec)
loader.exec_module(adapter)


class DirectSplitTests(unittest.TestCase):
    def setUp(self):
        self.anchor = {"pane_id": "p1", "terminal_id": "t1", "tab_id": "tb1",
                       "workspace_id": "sp1", "foreground_cwd": "/tmp/repo", "cwd": "/tmp"}
        self.world = Mock()
        self.world.resolve_pane.return_value = self.anchor
        self.argv = ["nvim", "--", "/tmp/a 'quoted'; $(command).lua"]

    def split(self, flags=None):
        with contextlib.redirect_stdout(io.StringIO()) as output, \
                contextlib.redirect_stderr(io.StringIO()) as errors:
            rc = adapter.handle_hc_herdr_cli(
                ["pane", "split", self.anchor["pane_id"], "--focus"]
                + (["--argv", json.dumps(self.argv)] if flags is None else flags))
        return rc, json.loads(output.getvalue() or errors.getvalue())

    def test_window_split_launches_exact_argv_without_sending_input(self):
        with patch.object(adapter, "HcWorld", return_value=self.world), \
                patch.object(adapter, "herdr_app_do", return_value={"pane": "p2", "terminal": "t2"}) as do, \
                patch.object(adapter, "hc_rpc") as rpc:
            rc, result = self.split()
        self.assertEqual(rc, 0)
        do.assert_called_once_with("pane.split", {"direction": "right", "pane": "p1", "argv": self.argv})
        rpc.assert_not_called()
        self.assertEqual(result["result"]["pane"]["terminal_id"], "t2")

    def test_remote_window_split_keeps_qualified_anchor(self):
        self.anchor["pane_id"] = "devserver/p1"
        with patch.object(adapter, "HcWorld", return_value=self.world), \
                patch.object(adapter, "herdr_app_do", return_value={"pane": "devserver/p2", "terminal": "devserver/t2"}) as do, \
                patch.object(adapter, "hc_rpc") as rpc:
            self.assertEqual(self.split()[0], 0)
        self.assertEqual(do.call_args.args[1]["pane"], "devserver/p1")
        rpc.assert_not_called()

    def test_remote_split_honors_ratio_and_restores_focus(self):
        self.anchor.update(pane_id="devserver/p1", tab_id="devserver/tb1", machine="devserver")
        with patch.object(adapter, "HcWorld", return_value=self.world), \
                patch.object(adapter, "herdr_app_do", return_value={"pane": "devserver/p2", "terminal": "devserver/t2"}) as do, \
                patch.object(adapter, "set_hc_split_ratio") as ratio, \
                patch.object(adapter, "hc_rpc") as rpc:
            self.assertEqual(self.split(["--argv", json.dumps(self.argv), "--no-focus", "--ratio", "0.6"])[0], 0)
        self.assertEqual(do.call_args_list[0].args,
                         ("pane.split", {"direction": "right", "pane": "devserver/p1", "argv": self.argv}))
        self.assertEqual(do.call_args_list[1].args, ("pane.focus", {"pane": "devserver/p1"}))
        ratio.assert_called_once_with("devserver/tb1", "devserver/p1", 0.6, machine="devserver")
        rpc.assert_not_called()

    def test_headless_split_passes_argv_to_core_and_does_not_keep_editor(self):
        doc = {"spaces": [{"id": "sp1", "tabs": [{"id": "tb1", "root": {
            "type": "row", "children": [{"id": "p1", "type": "block", "content": {"terminal": "t1"}}]
        }}]}]}
        calls = []
        def rpc(method, params):
            calls.append((method, copy.deepcopy(params)))
            if method == "terminal.run":
                return {"result": {"address": "t2"}}
            if method == "doc.get":
                return {"result": {"value": doc, "version": 1}}
            if method == "doc.set":
                return {"result": {}}
            self.fail(f"Unexpected IPC: {method}")
        with patch.object(adapter, "HcWorld", return_value=self.world), \
                patch.object(adapter, "herdr_app_do", return_value=None), \
                patch.object(adapter, "hc_rpc", side_effect=rpc):
            self.assertEqual(self.split()[0], 0)
        run = calls[0][1]
        self.assertEqual(run["argv"], self.argv)
        self.assertEqual(run["cwd"], "/tmp/repo")
        self.assertFalse(run["keep"])
        self.assertEqual([method for method, _ in calls], ["terminal.run", "doc.get", "doc.set"])
        leaves = calls[-1][1]["value"]["spaces"][0]["tabs"][0]["root"]["children"]
        self.assertEqual(leaves[1]["content"], {"terminal": "t2"})

    def test_plain_shell_split_remains_unchanged(self):
        with patch.object(adapter, "HcWorld", return_value=self.world), \
                patch.object(adapter, "herdr_app_do", return_value={"pane": "p2", "terminal": "t2"}) as do, \
                patch.object(adapter, "hc_rpc") as rpc:
            self.assertEqual(self.split([])[0], 0)
        do.assert_called_once_with("pane.split", {"direction": "right", "pane": "p1"})
        rpc.assert_not_called()

    def test_invalid_argv_or_shell_overrides_fail_before_mutation(self):
        flags = [["--argv"], ["--argv", "not json"], ["--argv", "{}"],
                 ["--argv", "[]"], ["--argv", '["", "file"]'], ["--argv", '["nvim", 4]'],
                 ["--argv", '["nvim"]', "--cwd", "/tmp"],
                 ["--argv", '["nvim"]', "--env", "A=B"]]
        for args in flags:
            with self.subTest(args=args), patch.object(adapter, "HcWorld", return_value=self.world), \
                    patch.object(adapter, "herdr_app_do") as do, patch.object(adapter, "hc_rpc") as rpc:
                self.assertEqual(self.split(args)[0], 1)
                do.assert_not_called()
                rpc.assert_not_called()

    def test_failed_split_is_not_retried_or_followed_by_input(self):
        with patch.object(adapter, "HcWorld", return_value=self.world), \
                patch.object(adapter, "herdr_app_do", side_effect=adapter.AdapterError("no reply")) as do, \
                patch.object(adapter, "hc_rpc") as rpc:
            with self.assertRaises(adapter.AdapterError):
                self.split()
        do.assert_called_once()
        rpc.assert_not_called()


@unittest.skipUnless(shutil.which("fish") and shutil.which("jq"), "fish and jq required")
class FileOpenerTests(unittest.TestCase):
    def run_opener(self, backend, file="/tmp/a 'quoted'; $(command).lua", reuse=False,
                   mime="text/plain"):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            # Use only fixture executables ahead of the inherited PATH.
            source = (ROOT / "bin/herdr-preset").read_text().replace(
                "set -x PATH /opt/homebrew/bin (status dirname) $PATH",
                "set -x PATH (status dirname) $PATH")
            opener = base / "herdr-preset"
            opener.write_text(source)
            opener.chmod(0o755)
            shim = base / "hc-preset"
            shim.write_text("""#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
with open(os.environ['OPEN_LOG'], 'a') as log:
    log.write(json.dumps(args) + '\\n')
if args[:2] == ['pane', 'get']:
    print(json.dumps({'result': {'pane': {'tab_id': 'tb1'}}}))
elif args[:2] == ['pane', 'list']:
    panes = [{'pane_id': 'p1', 'tab_id': 'tb1'}]
    if os.environ['REUSE'] == '1': panes.append({'pane_id': 'p2', 'tab_id': 'tb1'})
    print(json.dumps({'result': {'panes': panes}}))
elif args[:2] == ['pane', 'process-info']:
    print(json.dumps({'result': {'process_info': {'foreground_processes': [{'name': 'nvim', 'pid': 424242}]}}}))
elif args[:2] == ['pane', 'split']:
    print(json.dumps({'result': {'pane': {'pane_id': 'p3'}}}))
elif args[:2] in (['pane', 'run'], ['pane', 'focus']):
    print(json.dumps({'result': {'type': 'ok'}}))
elif args == ['backend']:
    print(os.environ['CANONICAL_BACKEND'])
else:
    sys.exit(2)
""")
            shim.chmod(0o755)
            for program, body in {
                "pgrep": "exit 0",
                "file": 'printf "%s\\n" "$FILE_MIME"',
                "icat": "exit 0",
                "lsof": "printf '%s\\n' /tmp/nvim.424242.0",
                "nvim": 'printf "%s\\n" "$@" > "$NVIM_LOG"',
            }.items():
                path = base / program
                path.write_text("#!/bin/sh\n" + body + "\n")
                path.chmod(0o755)
            env = {**os.environ, "HERDR_ACTIVE_PANE_ID": "p1", "HERDR_PANE_ID": "p1",
                   "OPEN_LOG": str(base / "calls"), "CANONICAL_BACKEND": "hc",
                   "NVIM_LOG": str(base / "nvim-calls"), "REUSE": "1" if reuse else "0",
                   "FILE_MIME": mime}
            if backend is None:
                env.pop("HC_PRESET_BACKEND", None)
            else:
                env["HC_PRESET_BACKEND"] = backend
            result = subprocess.run([str(opener), "open-file-with-fallback", file],
                                    env=env, capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            calls = [json.loads(line) for line in (base / "calls").read_text().splitlines()]
            nvim_log = base / "nvim-calls"
            nvim_calls = nvim_log.read_text().splitlines() if nvim_log.exists() else []
            return calls, nvim_calls

    def test_hc_opener_launches_editor_directly_and_preserves_literal_filename(self):
        file = "/tmp/a 'quoted'; $(command).lua"
        calls, _ = self.run_opener("hc", file)
        split = next(call for call in calls if call[:2] == ["pane", "split"])
        self.assertEqual(json.loads(split[split.index("--argv") + 1]), ["nvim", "--", file])
        self.assertFalse(any(call[:2] == ["pane", "run"] for call in calls))

    def test_images_get_fresh_viewer_even_with_existing_editor(self):
        file = "/tmp/image 'quoted'; $(command).PNG"
        calls, nvim_calls = self.run_opener("hc", file, reuse=True, mime="image/png")
        split = next(call for call in calls if call[:2] == ["pane", "split"])
        argv = json.loads(split[split.index("--argv") + 1])
        self.assertEqual(argv[:2], ["bash", "-c"])
        self.assertIn('read -r -n 1', argv[2])
        self.assertEqual(argv[3], "icat")
        self.assertEqual(Path(argv[4]).name, "icat")
        self.assertEqual(argv[5], file)
        self.assertEqual(nvim_calls, [])
        self.assertFalse(any(call[:2] in (["pane", "run"], ["pane", "focus"],
                                        ["pane", "process-info"]) for call in calls))

    def test_content_detection_beats_suffix_and_supports_extensionless_images(self):
        for file, mime in (("/tmp/image", "image/png"), ("/tmp/vector.svg", "image/svg+xml"),
                           ("/tmp/photo.WEBP", "application/octet-stream")):
            with self.subTest(file=file, mime=mime):
                calls, _ = self.run_opener("hc", file, mime=mime)
                split = next(call for call in calls if call[:2] == ["pane", "split"])
                self.assertEqual(json.loads(split[split.index("--argv") + 1])[3], "icat")
        calls, _ = self.run_opener("hc", "/tmp/text.png", mime="text/plain")
        split = next(call for call in calls if call[:2] == ["pane", "split"])
        self.assertEqual(json.loads(split[split.index("--argv") + 1]),
                         ["nvim", "--", "/tmp/text.png"])

    def test_opener_normalizes_backend_and_discovers_missing_or_invalid_override(self):
        for backend in (None, "HC", " hc ", "invalid"):
            with self.subTest(backend=backend):
                calls, _ = self.run_opener(backend)
                split = next(call for call in calls if call[:2] == ["pane", "split"])
                self.assertIn("--argv", split)
                self.assertFalse(any(call[:2] == ["pane", "run"] for call in calls))
                self.assertEqual(["backend"] in calls, backend in (None, "invalid"))

    def test_legacy_opener_still_uses_split_then_exec(self):
        calls, _ = self.run_opener("herdr", "/tmp/file.lua")
        split = next(call for call in calls if call[:2] == ["pane", "split"])
        self.assertNotIn("--argv", split)
        self.assertEqual(calls[-1], ["pane", "run", "p3", "exec nvim /tmp/file.lua"])

    def test_existing_editor_is_reused_without_splitting(self):
        calls, nvim_calls = self.run_opener("hc", "/tmp/file.lua", reuse=True)
        self.assertFalse(any(call[:2] in (["pane", "split"], ["pane", "run"]) for call in calls))
        self.assertEqual(nvim_calls, ["--server", "/tmp/nvim.424242.0", "--remote", os.path.realpath("/tmp/file.lua")])
        self.assertEqual(calls[-1], ["pane", "focus", "p2"])


if __name__ == "__main__":
    unittest.main()
