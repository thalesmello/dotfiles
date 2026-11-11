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
    def __init__(self, info=None, info_error=None, open_error=None, pane=None,
                 layout=None, agents=None, focus_error=None, close_error=None):
        super().__init__(bin_path="herdr", socket_path=None)
        self.info, self.info_error, self.open_error = info, info_error, open_error
        self.pane = pane
        self.layout = layout
        self.agents = agents
        self.focus_error = focus_error
        self.close_error = close_error
        self.calls = []

    def call(self, method, params, cli_args):
        self.calls.append((method, params))
        if method == "pane.process_info":
            if self.info_error is not None:
                raise self.info_error
            return {"process_info": self.info}
        if method == "pane.get":
            return {"pane": self.pane} if self.pane is not None else {}
        if method == "pane.layout":
            return {"layout": self.layout} if self.layout is not None else {}
        if method == "agent.list":
            return {"agents": self.agents} if self.agents is not None else {}
        if method == "agent.focus" and self.focus_error is not None:
            raise self.focus_error
        if method == "pane.close" and self.close_error is not None:
            raise self.close_error
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

    def test_busy_agent_popup_carries_session_title(self):
        pane = {"agent": "pi", "terminal_title": "⠋ pi - Fix the flaky test",
                "terminal_title_stripped": "Fix the flaky test"}
        runner = FakeRunner(BUSY, pane=pane)
        self.assertEqual(self.run_close(runner), "prompted")
        _, params = runner.calls[-1]
        self.assertEqual(params["env"][cc.ENV_TITLE], "Fix the flaky test")
        # Title lookup happens between process_info and the popup, never on idle.
        self.assertEqual([m for m, _ in runner.calls],
                         ["pane.process_info", "pane.get", "plugin.pane.open"])

    def test_busy_non_agent_popup_has_no_title(self):
        pane = {"terminal_title_stripped": "notes.md"}
        runner = FakeRunner(BUSY, pane=pane)
        self.assertEqual(self.run_close(runner), "prompted")
        _, params = runner.calls[-1]
        self.assertNotIn(cc.ENV_TITLE, params["env"])

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


class AgentTitleTest(unittest.TestCase):
    def test_prefers_stripped_title(self):
        pane = {"agent": "pi", "terminal_title": "⠋ pi - Chat",
                "terminal_title_stripped": "Chat"}
        self.assertEqual(cc.agent_title_from_pane(pane), "Chat")

    def test_falls_back_to_terminal_title_and_restored_token(self):
        self.assertEqual(cc.agent_title_from_pane(
            {"agent": "claude", "terminal_title": "  My   chat "}), "My chat")
        self.assertEqual(cc.agent_title_from_pane(
            {"agent": "claude", "tokens": {"restored_title": "Old chat"}}), "Old chat")

    def test_no_title_for_non_agent_blank_or_agent_name(self):
        self.assertEqual(cc.agent_title_from_pane({"terminal_title_stripped": "Chat"}), "")
        self.assertEqual(cc.agent_title_from_pane({"agent": "pi"}), "")
        self.assertEqual(cc.agent_title_from_pane({"agent": "pi", "terminal_title_stripped": "pi"}), "")
        self.assertEqual(cc.agent_title_from_pane({}), "")

    def test_fetch_failure_is_empty(self):
        runner = FakeRunner(BUSY)
        runner.pane = None
        self.assertEqual(cc.fetch_agent_title(runner, "w1:p1"), "")


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

    def test_shows_agent_title_instead_of_cmdline(self):
        view = cc.render_prompt("w1:p1", "pi", "pi --session-id abc -- do a thing",
                                width=64, title="Fix the flaky test")
        self.assertIn("pi", view)
        self.assertIn("Fix the flaky test", view)
        self.assertNotIn("--session-id", view)

    def test_unknown_process(self):
        view = cc.render_prompt("w1:p1", cc.UNKNOWN_PROCESS, "", width=64)
        self.assertIn("unknown process", view)
        self.assertIn("could not inspect", view)

    def test_truncate(self):
        self.assertEqual(cc.truncate("hello", 10), "hello")
        self.assertEqual(cc.truncate("hello world", 6), "hello…")
        self.assertEqual(cc.truncate("héllo wörld", 4), "hél…")
        self.assertEqual(cc.truncate("abc", 1), "abc")


_ah_spec = importlib.util.spec_from_file_location(
    "agent_handler", os.path.join(_HERE, "..", "agent-handler.py"))
ah = importlib.util.module_from_spec(_ah_spec)
sys.modules["agent_handler"] = ah
_ah_spec.loader.exec_module(ah)


class CloseFocusBehaviorTest(unittest.TestCase):
    def test_multi_pane_tab_keeps_tab_focus(self):
        # Another pane exists in the same tab: close_pane must NOT jump to
        # another agent, letting Herdr focus the sibling pane in the tab.
        layout = {"panes": [{"pane_id": "w1:p1", "focused": True},
                            {"pane_id": "w1:p2", "focused": False}]}
        agents = [
            {"pane_id": "w1:p1", "agent": "pi", "agent_status": "idle",
             "state_change_seq": 10, "focused": True},
            {"pane_id": "w2:p1", "agent": "pi", "agent_status": "idle",
             "state_change_seq": 9, "focused": False},
        ]
        runner = FakeRunner(BUSY, layout=layout, agents=agents)
        cc.close_pane(runner, "w1:p1")
        self.assertEqual(runner.calls, [
            ("pane.layout", {"pane_id": "w1:p1"}),
            ("pane.close", {"pane_id": "w1:p1"}),
        ])

    def test_last_pane_in_tab_focuses_next_agent_in_smart_order(self):
        # Single pane in tab: closing w1:p1 focuses the next agent in the
        # sidebar smart priority order (done -> idle newest first -> working).
        layout = {"panes": [{"pane_id": "w1:p2", "focused": True}]}
        agents = [
            {"pane_id": "w1:p1", "agent": "pi", "agent_status": "working",
             "state_change_seq": 50, "focused": False},
            {"pane_id": "w1:p2", "agent": "pi", "agent_status": "done",
             "state_change_seq": 20, "focused": True},
            {"pane_id": "w2:p1", "agent": "pi", "agent_status": "idle",
             "state_change_seq": 30, "focused": False},
            {"pane_id": "w3:p1", "agent": "pi", "agent_status": "idle",
             "state_change_seq": 40, "focused": False},
        ]
        # Smart order: w1:p2 (done), w3:p1 (idle seq 40), w2:p1 (idle seq 30), w1:p1 (working).
        # Closing w1:p2 -> next agent on the list is w3:p1, focused BEFORE pane.close
        # so Herdr never falls back to (or marks seen) the adjacent tab w1:p1, and
        # re-asserted after pane.close in case closing the tab also closed its workspace.
        runner = FakeRunner(BUSY, layout=layout, agents=agents)
        cc.close_pane(runner, "w1:p2")
        self.assertEqual(runner.calls, [
            ("pane.layout", {"pane_id": "w1:p2"}),
            ("agent.list", {}),
            ("agent.focus", {"target": "w3:p1"}),
            ("pane.close", {"pane_id": "w1:p2"}),
            ("agent.focus", {"target": "w3:p1"}),
        ])

    def test_close_failure_restores_original_focus(self):
        layout = {"panes": [{"pane_id": "w1:p1", "focused": True}]}
        agents = [
            {"pane_id": "w1:p1", "agent": "pi", "agent_status": "done",
             "state_change_seq": 20, "focused": True},
            {"pane_id": "w2:p1", "agent": "pi", "agent_status": "idle",
             "state_change_seq": 10, "focused": False},
        ]
        err = cc.CliError("workspace_group_close_required", "group close required")
        runner = FakeRunner(BUSY, layout=layout, agents=agents, close_error=err)
        with self.assertRaises(cc.CliError):
            cc.close_pane(runner, "w1:p1")
        self.assertEqual(runner.calls, [
            ("pane.layout", {"pane_id": "w1:p1"}),
            ("agent.list", {}),
            ("agent.focus", {"target": "w2:p1"}),
            ("pane.close", {"pane_id": "w1:p1"}),
            ("agent.focus", {"target": "w1:p1"}),
        ])

    def test_last_agent_in_list_focuses_previous_agent(self):
        layout = {"panes": [{"pane_id": "w2:p1", "focused": True}]}
        agents = [
            {"pane_id": "w1:p1", "agent": "pi", "agent_status": "done",
             "state_change_seq": 20, "focused": False},
            {"pane_id": "w2:p1", "agent": "pi", "agent_status": "idle",
             "state_change_seq": 10, "focused": True},
        ]
        runner = FakeRunner(BUSY, layout=layout, agents=agents)
        cc.close_pane(runner, "w2:p1")
        self.assertEqual(runner.calls[-3:], [
            ("agent.focus", {"target": "w1:p1"}),
            ("pane.close", {"pane_id": "w2:p1"}),
            ("agent.focus", {"target": "w1:p1"}),
        ])

    def test_respects_frozen_um_sort_and_pins(self):
        # w1:p1 turned from done to idle when focused, but its um_sort token is
        # frozen at rank 1 (done). The next agent after it is the other done
        # agent (w2:p1), not the idle agent below w3:p1.
        agents = [
            {"pane_id": "w1:p1", "agent": "pi", "agent_status": "idle",
             "state_change_seq": 100, "focused": True,
             "tokens": {"um_sort": cc.sort_token("done", 50)}},
            {"pane_id": "w2:p1", "agent": "pi", "agent_status": "done",
             "state_change_seq": 40, "focused": False,
             "tokens": {"um_sort": cc.sort_token("done", 40)}},
            {"pane_id": "w3:p1", "agent": "pi", "agent_status": "idle",
             "state_change_seq": 90, "focused": False,
             "tokens": {"um_sort": cc.sort_token("idle", 90)}},
        ]
        self.assertEqual(cc.pick_next_agent(agents, "w1:p1"), "w2:p1")

    def test_grouped_and_hidden_panel_modes(self):
        agents = [
            {"pane_id": "w1:p1", "agent": "pi", "agent_status": "working",
             "state_change_seq": 10, "focused": False},
            {"pane_id": "w1:p2", "agent": "pi", "agent_status": "done",
             "state_change_seq": 20, "focused": True},
            {"pane_id": "w1:p3", "agent": "pi", "agent_status": "working",
             "state_change_seq": 30, "focused": False},
            {"pane_id": "w2:p1", "agent": "pi", "agent_status": "idle",
             "state_change_seq": 5, "focused": False},
        ]
        # In grouped mode (agent.list order), the agent after w1:p2 is w1:p3.
        self.assertEqual(cc.pick_next_agent(agents, "w1:p2", mode="grouped"), "w1:p3")
        # In hidden mode (working filtered out), closing w2:p1 (the last non-working
        # agent) falls back to the remaining non-working agent w1:p2 instead of working w1:p3.
        agents[1]["focused"] = False
        agents[3]["focused"] = True
        self.assertEqual(cc.pick_next_agent(agents, "w2:p1", mode="hidden"), "w1:p2")

    def test_skips_snoozed_agents_and_unfocused_background_close(self):
        agents = [
            {"pane_id": "w1:p1", "agent": "pi", "agent_status": "done",
             "state_change_seq": 30, "focused": True},
            {"pane_id": "w2:p1", "agent": "pi", "agent_status": "done",
             "state_change_seq": 20, "focused": False,
             "tokens": {"herdr_snooze": "1"}},
            {"pane_id": "w3:p1", "agent": "pi", "agent_status": "idle",
             "state_change_seq": 10, "focused": False},
        ]
        self.assertEqual(cc.pick_next_agent(agents, "w1:p1"), "w3:p1")
        # Closing w3:p1 while w1:p1 is focused does not steal focus.
        self.assertIsNone(cc.pick_next_agent(agents, "w3:p1"))

    def test_agent_handler_reconciles_external_close(self):
        from unittest import mock

        agents_before = [
            {"pane_id": "w1:p1", "tab_id": "w1:t1", "terminal_id": "t1",
             "agent": "pi", "agent_status": "done", "state_change_seq": 20, "focused": True},
            {"pane_id": "w1:p2", "tab_id": "w1:t2", "terminal_id": "t2",
             "agent": "pi", "agent_status": "working", "state_change_seq": 30, "focused": False},
            {"pane_id": "w2:p1", "tab_id": "w2:t1", "terminal_id": "t3",
             "agent": "pi", "agent_status": "idle", "state_change_seq": 10, "focused": False},
        ]
        state = ah.reconcile_closed_agent_focus(agents_before, None, mode="smart")
        self.assertEqual(state["pane_id"], "w1:p1")
        self.assertEqual(state["candidates"], ["w2:p1", "w1:p2"])

        # Case 1: w1:p1 closed as the last pane in w1:t1; Herdr focused adjacent tab w1:p2.
        # agent-handler redirects focus to w2:p1 (next agent in smart list).
        agents_after = [
            {"pane_id": "w1:p2", "tab_id": "w1:t2", "terminal_id": "t2",
             "agent": "pi", "agent_status": "working", "state_change_seq": 30, "focused": True},
            {"pane_id": "w2:p1", "tab_id": "w2:t1", "terminal_id": "t3",
             "agent": "pi", "agent_status": "idle", "state_change_seq": 10, "focused": False},
        ]
        panes_after = [
            {"pane_id": "w1:p2", "tab_id": "w1:t2", "focused": True},
            {"pane_id": "w2:p1", "tab_id": "w2:t1", "focused": False},
        ]
        requests = []
        with mock.patch.object(ah, "fetch_panes", return_value=panes_after), \
                mock.patch.object(ah, "request", side_effect=lambda m, p: requests.append((m, p)) or {}):
            state_after = ah.reconcile_closed_agent_focus(agents_after, state, mode="smart")
        self.assertEqual(requests, [("agent.focus", {"target": "w2:p1"})])
        self.assertEqual(state_after["pane_id"], "w2:p1")

        # Case 2: w1:p1 closed, but another pane w1:p9 still exists in w1:t1.
        # agent-handler leaves focus on w1:p9 in the same tab.
        panes_with_sibling = [
            {"pane_id": "w1:p9", "tab_id": "w1:t1", "focused": True},
            {"pane_id": "w1:p2", "tab_id": "w1:t2", "focused": False},
            {"pane_id": "w2:p1", "tab_id": "w2:t1", "focused": False},
        ]
        requests = []
        with mock.patch.object(ah, "fetch_panes", return_value=panes_with_sibling), \
                mock.patch.object(ah, "request", side_effect=lambda m, p: requests.append((m, p)) or {}):
            ah.reconcile_closed_agent_focus(agents_after, state, mode="smart")
        self.assertEqual(requests, [])


if __name__ == "__main__":
    unittest.main()
