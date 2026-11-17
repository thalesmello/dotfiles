"""Ask-agent routing regressions. All agent/terminal commands use a fake CLI.

Run: python3 -m unittest discover -s scripts/tests -p test_ask_agent.py
"""
import json
import os
from pathlib import Path
import subprocess
import shutil
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
    result = {"root_pane": {"pane_id": "p-test", "tab_id": "tb-test", "terminal_id": "t-test"}}
elif args[:2] == ["pane", "process-info"]:
    result = {"process_info": {"shell_pid": 123,
              "foreground_processes": [{"pid": 123, "name": "fish"}]}}
elif args[:2] == ["agent", "get"]:
    result = {"agent": {"agent": "pi"}}
else:
    result = {}
print(json.dumps({"result": result}))
'''


FAKE_HC = r'''#!/usr/bin/env python3
import json
import os
import subprocess
import sys
args = sys.argv[1:]
with open(os.environ["ASK_TEST_CALLS"], "a") as f:
    f.write(json.dumps(["hc"] + args) + "\n")
if args == ["machine", "ls"]:
    print(os.environ["ASK_TEST_MACHINES"])
elif args[0] == "exec":
    assert args[args.index("--on") + 1] == "devserver"
    index = args.index("/bin/sh")
    env = dict(os.environ, HOME=os.environ["ASK_TEST_REMOTE_HOME"], PATH="/usr/bin:/bin",
               TMPDIR=os.environ["ASK_TEST_REMOTE_HOME"] + "/tmp")
    raise SystemExit(subprocess.call(args[index:], env=env))
else:
    raise SystemExit("unexpected fake hc call")
'''


class AskWorkspaceTests(unittest.TestCase):
    def run_ask(self, workspaces, question="qq tell me a joke about mac vs linux", backend="hc",
                machines=None, focus=False, default_machine="", expected_rc=0):
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
            hc = bin_dir / "hc"
            hc.write_text(FAKE_HC)
            hc.chmod(0o755)
            remote = home / "remote"
            remote_bin = remote / ".local/bin"
            remote_bin.mkdir(parents=True)
            (remote / "tmp").mkdir()
            for name in ("uname", "apfel"):
                shutil.copy2(bin_dir / name, remote_bin / name)
            remote_cli = remote / "src/dotfiles/bin/hc-preset"
            remote_cli.parent.mkdir(parents=True)
            shutil.copy2(cli, remote_cli)
            remote_scripts = remote / ".config/herdr/scripts"
            remote_scripts.mkdir(parents=True)
            for name in ("herdr-lib.sh", "prompt-lib.sh"):
                shutil.copy2(SCRIPT.parent / name, remote_scripts / name)
            prompt = home / "question.prompt"
            prompt.write_text(question)
            calls_file = home / "calls.jsonl"
            calls_file.touch()
            env = {**os.environ, "HOME": temp, "PATH": "/usr/bin:/bin",
                   "ASK_TEST_CALLS": str(calls_file),
                   "ASK_TEST_WORKSPACES": json.dumps(workspaces),
                   "ASK_TEST_BACKEND": backend,
                   "ASK_TEST_REMOTE_HOME": str(remote),
                   "ASK_TEST_MACHINES": json.dumps({"machines": machines or []}),
                   "ASK_AGENT_MACHINE": default_machine,
                   "ASK_AGENT_SHELL_WAIT_ATTEMPTS": "1",
                   "ASK_AGENT_DETECT_WAIT_ATTEMPTS": "1",
                   "HERDR_DIE_HOLD_CHARS": "999999"}
            mode = "--dispatch-foreground" if focus else "--dispatch"
            result = subprocess.run(["/bin/bash", str(SCRIPT), mode, str(prompt)],
                                    env=env, capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, expected_rc, result.stdout + result.stderr)
            calls = [json.loads(line) for line in calls_file.read_text().splitlines()]
            creates = [c for c in calls if c[:2] in
                       (["workspace", "create"], ["tab", "create"])]
            self.last_calls = calls
            self.last_result = result
            self.last_remote_home = str(remote)
            self.last_prompt_files = {str(p): p.read_text() for p in (remote / "tmp").glob("ask-agent-*.md")}
            self.assertEqual(len(creates), 1 if expected_rc == 0 else 0)
            if expected_rc == 0:
                self.assertIn(["pane", "run", "p-test"], [c[:3] for c in calls])
                self.assertIn("asked mac-linux-joke", result.stdout)
            return creates[0] if creates else None, temp

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

    def test_machine_qq_uses_target_home_and_keeps_background_focus(self):
        create, home = self.run_ask([], "machine:devserver qq tell me a joke",
                                   machines=[{"name": "devserver", "state": "connected"}])
        self.assertEqual(create[create.index("--cwd") + 1], f"{home}/remote/src/qq")
        self.assertIn("--no-focus", create)
        self.assertTrue(any(c[:2] == ["hc", "exec"] for c in self.last_calls))
        self.assertFalse(any(c[:4] == ["--backend", "hc", "do", "agent.focus"] for c in self.last_calls))
        self.assertIn("dispatching to devserver", self.last_result.stdout)
        self.assertNotIn("machine:devserver", next(c[3] for c in self.last_calls if c[:2] == ["pane", "run"]))

    def test_machine_project_multiline_prompt_is_written_on_target(self):
        create, home = self.run_ask([], "project:repo machine:devserver qq question\nsecond line",
                                   machines=[{"name": "devserver", "state": "connected"}], focus=True)
        self.assertEqual(create[create.index("--cwd") + 1], f"{home}/remote/src/repo")
        self.assertIn("--focus", create)
        self.assertIn(["--backend", "hc", "do", "agent.focus", "--terminal", "devserver/t-test"], self.last_calls)
        self.assertEqual(list(self.last_prompt_files.values()), ["qq question\nsecond line\n"])
        self.assertNotIn("machine:devserver", next(c[3] for c in self.last_calls if c[:2] == ["pane", "run"]))

    def test_popup_default_machine_uses_remote_without_recursive_dispatch(self):
        create, home = self.run_ask([], default_machine="devserver",
                                   machines=[{"name": "devserver", "state": "connected"}])
        self.assertEqual(create[create.index("--cwd") + 1], f"{home}/remote/src/qq")
        self.assertEqual(sum(c[:2] == ["hc", "exec"] for c in self.last_calls), 1)

    def test_unknown_machine_fails_before_workspace_creation(self):
        self.run_ask([], "machine:missing qq question", expected_rc=1)
        self.assertIn("not a connected machine", self.last_result.stderr)
        self.assertFalse(any(c[:2] == ["hc", "exec"] for c in self.last_calls))

    def test_disconnected_machine_is_not_used(self):
        self.run_ask([], "machine:devserver qq question",
                     machines=[{"name": "devserver", "state": "disconnected"}], expected_rc=1)
        self.assertIn("not a connected machine", self.last_result.stderr)

    def test_duplicate_or_empty_machine_selector_fails(self):
        for question in ("machine:devserver machine:other qq question", "machine: qq question"):
            with self.subTest(question=question):
                self.run_ask([], question, expected_rc=1)
                self.assertFalse(any(c[:2] == ["hc", "exec"] for c in self.last_calls))

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
