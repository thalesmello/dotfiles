"""Ask-agent routing regressions. All agent/terminal commands use a fake CLI.

Run: python3 -m unittest discover -s scripts/tests -p test_ask_agent.py
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = (Path(__file__).resolve().parents[2] /
          "stow_modules/main/dot-config/herdr/scripts/ask-agent.sh")

FAKE_CLI = r'''#!/usr/bin/env python3
import json
import os
import sys

args = sys.argv[1:]
with open(os.environ["ASK_TEST_CALLS"], "a") as f:
    f.write(json.dumps(args) + "\n")
if args == ["backend"]:
    print(os.environ["ASK_TEST_BACKEND"])
    raise SystemExit(0)
if args[:2] == ["workspace", "list"]:
    result = {"workspaces": json.loads(os.environ["ASK_TEST_WORKSPACES"])}
elif args[:2] in (["workspace", "create"], ["tab", "create"]):
    result = {"root_pane": {"pane_id": "p-test", "tab_id": "tb-test"}}
elif args[:2] == ["pane", "process-info"]:
    result = {"process_info": {"shell_pid": 123,
              "foreground_processes": [{"pid": 123, "name": "fish"}]}}
elif args[:2] == ["agent", "get"]:
    result = {"agent": {"agent": "pi"}}
else:
    result = {}
print(json.dumps({"result": result}))
'''


class AskWorkspaceTests(unittest.TestCase):
    def run_ask(self, workspaces, question="qq tell me a joke about mac vs linux", backend="hc"):
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp)
            bin_dir = home / ".local/bin"
            bin_dir.mkdir(parents=True)
            cli = home / "src/dotfiles/bin/hc-preset"
            cli.parent.mkdir(parents=True)
            cli.write_text(FAKE_CLI)
            cli.chmod(0o755)
            # Never invoke a real router, even on machines with apfel installed.
            for name, body in {
                "uname": "printf 'Darwin\\n'",
                "apfel": "printf '%s\\n' '{\"slug\":\"mac-linux-joke\",\"classification\":\"quick\"}'",
            }.items():
                stub = bin_dir / name
                stub.write_text("#!/bin/sh\n" + body + "\n")
                stub.chmod(0o755)
            prompt = home / "question.prompt"
            prompt.write_text(question)
            calls_file = home / "calls.jsonl"
            env = {**os.environ, "HOME": temp, "PATH": "/usr/bin:/bin",
                   "ASK_TEST_CALLS": str(calls_file),
                   "ASK_TEST_WORKSPACES": json.dumps(workspaces),
                   "ASK_TEST_BACKEND": backend,
                   "ASK_AGENT_SHELL_WAIT_ATTEMPTS": "1",
                   "ASK_AGENT_DETECT_WAIT_ATTEMPTS": "1",
                   "HERDR_DIE_HOLD_CHARS": "999999"}
            result = subprocess.run(["/bin/bash", str(SCRIPT), "--dispatch", str(prompt)],
                                    env=env, capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            calls = [json.loads(line) for line in calls_file.read_text().splitlines()]
            creates = [c for c in calls if c[:2] in
                       (["workspace", "create"], ["tab", "create"])]
            self.assertEqual(len(creates), 1)
            self.assertIn(["pane", "run", "p-test"], [c[:3] for c in calls])
            self.assertIn("asked mac-linux-joke", result.stdout)
            return creates[0], temp

    def test_remote_only_qq_creates_local_workspace(self):
        create, home = self.run_ask([
            {"workspace_id": "devserver/sp-qq", "label": "qq", "machine": "devserver"},
        ])
        self.assertEqual(create[:2], ["workspace", "create"])
        self.assertEqual(create[create.index("--label") + 1], "qq")
        self.assertEqual(create[create.index("--cwd") + 1], f"{home}/src/qq")
        self.assertEqual(create[create.index("--machine") + 1], "")
        self.assertIn("--no-focus", create)

    def test_local_qq_is_reused_even_when_remote_is_first(self):
        create, _ = self.run_ask([
            {"workspace_id": "devserver/sp-qq", "label": "qq", "machine": "devserver"},
            {"workspace_id": "sp-local", "label": "qq", "machine": None},
        ])
        self.assertEqual(create[:2], ["tab", "create"])
        self.assertEqual(create[create.index("--workspace") + 1], "sp-local")

    def test_missing_machine_field_remains_compatible(self):
        create, _ = self.run_ask([{"workspace_id": "w1", "label": "qq"}])
        self.assertEqual(create[create.index("--workspace") + 1], "w1")

    def test_empty_workspace_list_creates_local_qq(self):
        create, _ = self.run_ask([])
        self.assertEqual(create[:2], ["workspace", "create"])
        self.assertEqual(create[create.index("--machine") + 1], "")

    def test_legacy_backend_does_not_get_hc_machine_option(self):
        create, _ = self.run_ask([], backend="herdr")
        self.assertEqual(create[:2], ["workspace", "create"])
        self.assertNotIn("--machine", create)

    def test_config_does_not_reuse_remote_src(self):
        create, home = self.run_ask([
            {"workspace_id": "devserver/sp-src", "label": "src", "machine": "devserver"},
        ], "config fix my shell")
        self.assertEqual(create[:2], ["workspace", "create"])
        self.assertEqual(create[create.index("--label") + 1], "src")
        self.assertEqual(create[create.index("--cwd") + 1], f"{home}/src")

    def test_project_does_not_reuse_remote_project(self):
        create, home = self.run_ask([
            {"workspace_id": "devserver/sp-repo", "label": "repo", "machine": "devserver"},
        ], "project:repo explain the code")
        self.assertEqual(create[:2], ["workspace", "create"])
        self.assertEqual(create[create.index("--label") + 1], "repo")
        self.assertEqual(create[create.index("--cwd") + 1], f"{home}/src/repo")


if __name__ == "__main__":
    unittest.main()
