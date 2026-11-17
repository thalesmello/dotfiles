"""Literal completion/key handling and connected-machine discovery; no live IPC."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

SCRIPTS = Path(__file__).resolve().parents[2] / "stow_modules/main/dot-config/herdr/scripts"


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / file)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


prompt = load("machine_prompt_lib", "prompt-lib.py")
helper = load("ask_machine", "ask-machine.py")


class CompletionTests(unittest.TestCase):
    def edit(self, data, spec='machine:=["devserver","work-mac"]'):
        _, completions, _, _ = prompt.parse_line_options(["--complete-values", spec])
        with patch.dict("os.environ", {"PROMPT_LIB_HISTORY": "0"}):
            editor = prompt.Prompt(prompt._DoctestTerminal(data), "Ask: ", "", "test", complete=completions)
            return editor.run(), editor.buf

    def test_prefix_and_tab_accept(self):
        self.assertEqual(self.edit(b"machine:dev\tqq hi\r"), (0, "machine:devserver qq hi"))

    def test_arrow_navigation_and_enter_accept(self):
        self.assertEqual(self.edit(b"machine:\x0e\rqq hi\r"), (0, "machine:work-mac qq hi"))

    def test_subsequence_matching(self):
        self.assertEqual(self.edit(b"machine:ds\r\r"), (0, "machine:devserver "))

    def test_exact_choice_submits_without_accepting_menu(self):
        self.assertEqual(self.edit(b"machine:devserver\r"), (0, "machine:devserver"))

    def test_empty_candidates_preserve_typing(self):
        self.assertEqual(self.edit(b"machine:dev\r", "machine:=[]"), (0, "machine:dev"))

    def test_directory_and_literal_sources_coexist(self):
        _, complete, _, _ = prompt.parse_line_options([
            "--complete", "project:=/tmp", "--complete-values", 'machine:=["devserver"]',
        ])
        self.assertEqual(complete, [("project:", "/tmp"), ("machine:", ["devserver"])])

    def test_invalid_literal_choices_are_rejected(self):
        for spec in ('machine:={}', 'machine:=[1]', 'machine:=[""]', 'machine:=["bad name"]', '=[]'):
            with self.subTest(spec=spec), self.assertRaises(ValueError):
                prompt.parse_line_options(["--complete-values", spec])

    def test_directory_completion_still_works(self):
        with prompt._dir_tree_for_doctest("alpha", "beta") as directory:
            self.assertEqual(prompt._edit_for_doctest(b"project:a\r\r", complete=[f"project:={directory}"]),
                             (0, "project:alpha "))


class MachineDiscoveryTests(unittest.TestCase):
    def test_only_connected_nontemporary_machine_names_are_offered(self):
        result = Mock(returncode=0, stdout=json.dumps({"machines": [
            {"name": "devserver", "state": "connected"},
            {"name": "devserver", "state": "connected"},
            {"name": "work-mac", "state": "connected"},
            {"name": "offline", "state": "disconnected"},
            {"name": "starting", "state": "connecting"},
            {"name": "sandbox", "state": "connected", "temporary": True},
        ]}))
        with patch.object(helper.subprocess, "run", return_value=result) as run:
            self.assertEqual(helper.connected_machines("/bin/hc"), ["devserver", "work-mac"])
            run.assert_called_once_with(["/bin/hc", "machine", "ls"],
                                        capture_output=True, text=True, timeout=10)

    def test_unknown_machine_is_rejected_before_exec(self):
        with patch.object(helper, "connected_machines", return_value=["devserver"]), \
                patch.object(helper.subprocess, "run") as run:
            with self.assertRaisesRegex(ValueError, "not a connected machine"):
                helper.dispatch("hc", "bad;rm", False, SCRIPTS / "ask-agent.sh", "adapter", "question")
            run.assert_not_called()

    def test_remote_runner_supplies_linux_runtime_socket_to_old_adapters(self):
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp)
            scripts = home / ".config/herdr/scripts"
            scripts.mkdir(parents=True)
            for name in ("herdr-lib.sh", "prompt-lib.sh"):
                (scripts / name).touch()
            runtime = home / "runtime"
            socket = runtime / "herdr-core/smoke.sock"
            socket.parent.mkdir(parents=True)
            socket.touch()
            request = {"script": r'''printf '%s\n' "$HC_SOCKET"; printf '%s' '{"result":{"root_pane":{"terminal_id":"t-test"}}}' >"$ASK_AGENT_RESULT_FILE"''',
                       "question": "question", "focus": False}
            env = {**os.environ, "HOME": temp, "TMPDIR": temp, "HC_SESSION": "smoke",
                   "XDG_RUNTIME_DIR": str(runtime), "HC_SOCKET": ""}
            result = subprocess.run([sys.executable, "-c", helper.REMOTE_RUNNER],
                                    input=json.dumps(request), env=env,
                                    capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.splitlines()[0], str(socket))
            self.assertIn(helper.RESULT_PREFIX, result.stdout)

    def test_failed_exec_is_not_retried_or_focused(self):
        with patch.object(helper, "connected_machines", return_value=["devserver"]), \
                patch.object(helper.subprocess, "run", return_value=Mock(returncode=1, stdout="", stderr="")) as run:
            self.assertEqual(helper.dispatch("hc", "devserver", True, SCRIPTS / "ask-agent.sh", "adapter", "question"), 1)
            self.assertEqual(run.call_count, 1)


if __name__ == "__main__":
    unittest.main()
