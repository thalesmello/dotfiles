"""Legacy agent-handler snooze visibility follows its existing focus freeze."""
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parents[1]


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


ah = load("agent_handler_snooze_focus", "agent-handler.py")
snooze = load("snooze_focus_test", "herdr-snooze.py")


def visible(query, tokens):
    if query["op"] == "any":
        return any(visible(f, tokens) for f in query["filters"])
    if query["op"] == "not":
        return not visible(query["filter"], tokens)
    if query["op"] == "exists":
        return query["field"]["token"] in tokens
    raise AssertionError(query)


class FocusedSnooze(unittest.TestCase):
    def test_immediate_label_but_deferred_hide_and_resort(self):
        captured = ah.sort_token("done", 50)
        tokens = {ah.SORT_TOKEN: captured, ah.ACTIVE_TOKEN: "1",
                  snooze.TOKEN: "z 1h", snooze.MARK: "1"}
        agent = {"pane_id": "p1", "terminal_id": "t1", "agent": "pi", "agent_status": "working",
                 "state_change_seq": 100, "focused": True, "tokens": tokens}
        frozen = {"t1": captured}
        patches = []
        with mock.patch.object(ah, "report_tokens", side_effect=lambda p, t: patches.append(t)):
            ah.sync_agents([agent], set(), set(), 0, None, frozen)
            self.assertEqual(patches[-1][ah.SORT_TOKEN], captured)
            self.assertEqual(patches[-1][ah.ACTIVE_TOKEN], "1")
            self.assertEqual(tokens[snooze.TOKEN], "z 1h")
            self.assertTrue(visible(snooze.VIEW_FILTER, tokens))
            agent["focused"] = False
            ah.sync_agents([agent], set(), set(), 0, None, frozen)
        patch = patches[-1]
        self.assertIsNone(patch[ah.ACTIVE_TOKEN])
        self.assertEqual(patch[ah.SORT_TOKEN], ah.sort_token("working", 100))
        self.assertNotIn("t1", frozen)
        tokens = {k: v for k, v in {**tokens, **patch}.items() if v is not None}
        self.assertFalse(visible(snooze.VIEW_FILTER, tokens))
        self.assertEqual(tokens[snooze.TOKEN], "z 1h", "badge survives the focus transition")

    def test_awake_agents_and_snoozed_list_are_unaffected(self):
        self.assertTrue(visible(snooze.VIEW_FILTER, {}))
        self.assertFalse(visible(snooze.VIEW_FILTER, {snooze.MARK: "1"}))
        self.assertTrue(visible(snooze.VIEW_FILTER, {snooze.MARK: "1", ah.ACTIVE_TOKEN: "1"}))
        self.assertTrue(visible(snooze.SNOOZED_LIST_FILTER["filters"][0], {snooze.MARK: "1"}))


if __name__ == "__main__":
    unittest.main()
