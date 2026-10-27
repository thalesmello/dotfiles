"""Regression tests for herdr-snooze action pane/workspace resolution.

The snooze keys are [[keys.command]] type = "shell" bindings, and shell
commands get HERDR_ACTIVE_PANE_ID / HERDR_ACTIVE_WORKSPACE_ID — not the
HERDR_PLUGIN_CONTEXT_JSON a plugin_action gets, and not HERDR_PANE_ID
(which only exists inside a pane's own shell). The upstream actions only
read the plugin context, so the keybinding found no pane and reported
"no agent to snooze". These tests pin the shell-command env path.
"""

import importlib.util
import os
import sys
import unittest
from unittest import mock

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "herdr_snooze", os.path.join(_HERE, "..", "herdr-snooze.py"))
snooze = importlib.util.module_from_spec(_spec)
sys.modules["herdr_snooze"] = snooze
_spec.loader.exec_module(snooze)

PANES = [
    {"pane_id": "w1:p1", "workspace_id": "w1", "agent": "claude",
     "agent_status": "working", "terminal_id": "t1", "title": "Fix it", "tokens": {}},
    {"pane_id": "w1:p2", "workspace_id": "w1", "agent": "",
     "agent_status": "", "terminal_id": "t2", "title": "", "tokens": {}},
]


def fake_call(method, params=None, timeout=5.0):
    if method == "pane.list":
        return {"panes": PANES}
    if method == "workspace.list":
        return {"workspaces": [{"workspace_id": "w1", "label": "web"}]}
    raise AssertionError(method)


class ActionEnvTest(unittest.TestCase):
    def run_agent_action(self, env):
        with mock.patch.object(snooze, "call", fake_call), \
                mock.patch.object(snooze, "read_state", return_value={"panes": {}, "workspaces": {}, "woke": {}}), \
                mock.patch.object(snooze, "open_picker", return_value=0) as picker, \
                mock.patch.object(snooze, "notify") as notify, \
                mock.patch.dict(os.environ, env, clear=False):
            for key in ("HERDR_PLUGIN_CONTEXT_JSON", "HERDR_ACTIVE_PANE_ID", "HERDR_PANE_ID"):
                if key not in env:
                    os.environ.pop(key, None)
            code = snooze.run_action("agent")
        return code, picker, notify

    def test_shell_command_env_finds_the_agent(self):
        code, picker, notify = self.run_agent_action({"HERDR_ACTIVE_PANE_ID": "w1:p1"})
        self.assertEqual(code, 0)
        picker.assert_called_once()
        env = picker.call_args[0][0]
        self.assertEqual(env["HERDR_SNOOZE_TARGET"], "w1:p1")
        notify.assert_not_called()

    def test_shell_pane_without_agent_says_so(self):
        code, picker, notify = self.run_agent_action({"HERDR_ACTIVE_PANE_ID": "w1:p2"})
        self.assertEqual(code, 1)
        picker.assert_not_called()
        self.assertIn("no agent", notify.call_args[0][1])

    def test_plugin_context_still_wins(self):
        code, picker, _notify = self.run_agent_action({
            "HERDR_PLUGIN_CONTEXT_JSON": '{"focused_pane_id": "w1:p1", "workspace_id": "w1"}',
            "HERDR_ACTIVE_PANE_ID": "w1:p2",
        })
        self.assertEqual(code, 0)
        self.assertEqual(picker.call_args[0][0]["HERDR_SNOOZE_TARGET"], "w1:p1")


if __name__ == "__main__":
    unittest.main()
