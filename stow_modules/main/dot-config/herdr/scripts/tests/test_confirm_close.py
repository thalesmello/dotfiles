"""Tests for scripts/confirm-close.py.

Translated from the upstream Go tests in asumaran/asconfirmclose
(classify_test.go, close_test.go, ui_test.go, config_test.go), adapted to
the Python port's function and runner shapes. The upstream repo's test
intent and cases are kept; only the harness differs.
"""

import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "confirm_close", os.path.join(_HERE, "..", "confirm-close.py"))
cc = importlib.util.module_from_spec(_spec)
sys.modules["confirm_close"] = cc
_spec.loader.exec_module(cc)


class ProcessDisplayNameTest(unittest.TestCase):
    def test_cases(self):
        cases = [
            ({"name": "2.1.233", "argv0": "claude", "argv": ["claude", "--flag"]}, "claude"),
            ({"name": "zsh", "argv0": "-zsh"}, "zsh"),
            ({"name": "node", "argv0": "/usr/local/bin/node"}, "node"),
            ({"name": "node", "argv0": "npm exec chrome-devtools-mcp@latest"}, "npm"),
            ({"name": "x", "argv": ["/opt/webpack/bin/webpack", "serve"]}, "webpack"),
            ({"name": "sleep"}, "sleep"),
            ({}, ""),
        ]
        for entry, want in cases:
            with self.subTest(entry=entry):
                self.assertEqual(cc.process_display_name(entry), want)


class ClassifyTest(unittest.TestCase):
    def test_idle_shell(self):
        info = {"pane_id": "w1:p1", "shell_pid": 100, "foreground_process_group_id": 100,
                "foreground_processes": [{"pid": 100, "name": "zsh", "argv0": "-zsh", "cmdline": "-zsh"}]}
        self.assertFalse(cc.classify(info).busy)

    def test_nested_shells_are_idle(self):
        info = {"shell_pid": 100, "foreground_process_group_id": 200,
                "foreground_processes": [{"pid": 200, "name": "bash", "argv0": "bash"},
                                         {"pid": 201, "name": "fish", "argv0": "/opt/homebrew/bin/fish"}]}
        self.assertFalse(cc.classify(info).busy)

    def test_agent_picks_group_leader(self):
        info = {"shell_pid": 55707, "foreground_process_group_id": 93720,
                "foreground_processes": [
                    {"pid": 9314, "name": "caffeinate", "argv0": "caffeinate", "cmdline": "caffeinate -i -t 300"},
                    {"pid": 94236, "name": "node", "argv0": "chrome-devtools-mcp"},
                    {"pid": 94216, "name": "node", "argv0": "npm exec chrome-devtools-mcp@latest"},
                    {"pid": 93720, "name": "2.1.233", "argv0": "claude", "cmdline": "claude --enable-auto-mode"},
                ]}
        v = cc.classify(info)
        self.assertTrue(v.busy)
        self.assertEqual(v.process, "claude")
        self.assertEqual(v.cmdline, "claude --enable-auto-mode")

    def test_falls_back_to_first_busy_process(self):
        info = {"shell_pid": 1, "foreground_process_group_id": 50,
                "foreground_processes": [
                    {"pid": 50, "name": "bash", "argv0": "bash", "cmdline": "bash -c webpack serve"},
                    {"pid": 51, "name": "node", "argv0": "webpack", "cmdline": "webpack serve --hot"},
                ]}
        v = cc.classify(info)
        self.assertTrue(v.busy)
        self.assertEqual(v.process, "webpack")

    def test_direct_process_without_shell(self):
        info = {"shell_pid": 300, "foreground_process_group_id": 300,
                "foreground_processes": [{"pid": 300, "name": "vim", "argv0": "vim", "cmdline": "vim notes.md"}]}
        v = cc.classify(info)
        self.assertTrue(v.busy)
        self.assertEqual(v.process, "vim")

    def test_ignore_list_case_insensitive(self):
        info = {"shell_pid": 1, "foreground_process_group_id": 2,
                "foreground_processes": [{"pid": 2, "name": "less", "argv0": "less"}]}
        self.assertFalse(cc.classify(info, {"less"}).busy)
        self.assertTrue(cc.classify(info).busy)
        info["foreground_processes"][0]["argv0"] = "/usr/bin/LESS"
        self.assertFalse(cc.classify(info, {"less"}).busy)

    def test_unknown_job_is_busy(self):
        v = cc.classify({"shell_pid": 1, "foreground_process_group_id": 2, "foreground_processes": []})
        self.assertTrue(v.busy)
        self.assertEqual(v.process, cc.UNKNOWN_PROCESS)

    def test_no_info_is_idle(self):
        self.assertFalse(cc.classify({"shell_pid": 1, "foreground_process_group_id": 1}).busy)
        self.assertFalse(cc.classify({}).busy)


IDLE = {"foreground_process_group_id": 10, "shell_pid": 10,
        "foreground_processes": [{"pid": 10, "name": "zsh", "argv0": "-zsh", "cmdline": "-zsh"}]}
BUSY = {"foreground_process_group_id": 20, "shell_pid": 10,
        "foreground_processes": [{"pid": 20, "name": "2.1.233", "argv0": "claude",
                                  "argv": ["claude", "--enable-auto-mode"],
                                  "cmdline": "claude --enable-auto-mode"}]}


class FakeRunner(cc.HerdrRunner):
    def __init__(self, info=None, info_error=None, open_error=None):
        super().__init__(bin_path="herdr", socket_path=None)
        self.info, self.info_error, self.open_error = info, info_error, open_error
        self.calls = []

    def call(self, method, params, cli_args):
        self.calls.append((method, params))
        if method == "pane.process_info":
            if self.info_error is not None:
                raise self.info_error
            return {"process_info": self.info}
        if method == "plugin.pane.open" and self.open_error is not None:
            raise self.open_error
        return {}


class RunCloseTest(unittest.TestCase):
    def run_close(self, runner, cfg=None, **kw):
        return cc.run_close(runner, cfg or cc.Config(), pane_id="w1:p1",
                            log=io.StringIO(), **kw)

    def test_idle_closes_immediately(self):
        runner = FakeRunner(IDLE)
        self.assertEqual(self.run_close(runner), "closed")
        self.assertEqual([m for m, _ in runner.calls], ["pane.process_info", "pane.close"])

    def test_busy_opens_popup(self):
        runner = FakeRunner(BUSY)
        self.assertEqual(self.run_close(runner), "prompted")
        self.assertNotIn("pane.close", [m for m, _ in runner.calls])
        method, params = runner.calls[-1]
        self.assertEqual(method, "plugin.pane.open")
        self.assertEqual(params["plugin_id"], cc.PLUGIN_ID)
        self.assertEqual(params["entrypoint"], cc.PROMPT_ENTRYPOINT)
        self.assertEqual(params["width"], 64)
        self.assertEqual(params["height"], 9)
        self.assertEqual(params["env"][cc.ENV_PANE_ID], "w1:p1")
        self.assertEqual(params["env"][cc.ENV_PROCESS], "claude")
        self.assertEqual(params["env"][cc.ENV_CMDLINE], "claude --enable-auto-mode")

    def test_popup_uses_configured_size(self):
        cfg = cc.Config()
        cfg.popup.width, cfg.popup.height = "50%", "12"
        runner = FakeRunner(BUSY)
        self.run_close(runner, cfg)
        _, params = runner.calls[-1]
        self.assertEqual(params["width"], "50%")
        self.assertEqual(params["height"], 12)

    def test_ignored_process_closes(self):
        cfg = cc.Config(ignore=["Claude"])
        runner = FakeRunner(BUSY)
        self.assertEqual(self.run_close(runner, cfg), "closed")

    def test_process_info_failure_falls_back_to_prompt(self):
        runner = FakeRunner(info_error=RuntimeError("boom"))
        self.assertEqual(self.run_close(runner), "prompted")
        _, params = runner.calls[-1]
        self.assertEqual(params["env"][cc.ENV_PROCESS], cc.UNKNOWN_PROCESS)
        self.assertNotIn(cc.ENV_CMDLINE, params["env"])

    def test_unknown_pane_is_an_error(self):
        runner = FakeRunner(info_error=cc.CliError("pane_not_found", "pane not found"))
        with self.assertRaises(cc.CliError):
            self.run_close(runner)
        self.assertEqual(len(runner.calls), 1)

    def test_popup_failure_is_reported(self):
        runner = FakeRunner(BUSY, open_error=cc.CliError("ui_busy", "another modal is active"))
        with self.assertRaises(cc.CliError):
            self.run_close(runner)

    def test_vim_forwarding(self):
        vim = {"foreground_process_group_id": 20, "shell_pid": 10,
               "foreground_processes": [{"pid": 20, "name": "nvim", "argv0": "nvim"}]}
        runner = FakeRunner(vim)
        self.assertEqual(self.run_close(runner, forward_vim=True), "forwarded")
        self.assertEqual(runner.calls[-1],
                         ("pane.send_keys", {"pane_id": "w1:p1", "keys": ["ctrl+space", "backspace"]}))
        # Without --forward-vim, vim is busy and prompts like anything else.
        runner = FakeRunner(vim)
        self.assertEqual(self.run_close(runner), "prompted")


class ConfigTest(unittest.TestCase):
    def test_defaults(self):
        for directory in ("", tempfile.mkdtemp()):
            cfg, err = cc.load_config(directory)
            self.assertIsNone(err)
            self.assertEqual(cfg.popup.width, "64")
            self.assertEqual(cfg.popup.height, "9")
            self.assertEqual(cfg.ignore, [])

    def test_file(self):
        with tempfile.TemporaryDirectory() as directory:
            with open(os.path.join(directory, "config.json"), "w") as handle:
                handle.write('{"ignore": ["less", " MAN ", ""], "popup": {"width": "50%"}}')
            cfg, err = cc.load_config(directory)
            self.assertIsNone(err)
            self.assertEqual(cfg.ignore_set(), {"less", "man"})
            self.assertEqual(cfg.popup.width, "50%")
            self.assertEqual(cfg.popup.height, "9")

    def test_unknown_and_malformed_are_errors_with_defaults(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "config.json")
            with open(path, "w") as handle:
                handle.write('{"ignroe": ["less"]}')
            cfg, err = cc.load_config(directory)
            self.assertIsNotNone(err)
            self.assertEqual(cfg.popup.width, "64")
            with open(path, "w") as handle:
                handle.write('{"ignore": [')
            _, err = cc.load_config(directory)
            self.assertIsNotNone(err)


class RenderPromptTest(unittest.TestCase):
    def test_shows_process(self):
        view = cc.render_prompt("w1:p1", "claude", "claude --enable-auto-mode", width=64)
        for want in ("Close pane?", "w1:p1", "claude", "claude --enable-auto-mode", "enter", "close", "keep"):
            self.assertIn(want, view)

    def test_hides_cmdline_when_same_as_process(self):
        view = cc.render_prompt("w1:p1", "vim", "vim", width=64)
        self.assertEqual(view.count("vim"), 1)

    def test_unknown_process(self):
        view = cc.render_prompt("w1:p1", cc.UNKNOWN_PROCESS, "", width=64)
        self.assertIn("unknown process", view)
        self.assertIn("could not inspect", view)

    def test_truncate(self):
        self.assertEqual(cc.truncate("hello", 10), "hello")
        self.assertEqual(cc.truncate("hello world", 6), "hello…")
        self.assertEqual(cc.truncate("héllo wörld", 4), "hél…")
        self.assertEqual(cc.truncate("abc", 1), "abc")


if __name__ == "__main__":
    unittest.main()
