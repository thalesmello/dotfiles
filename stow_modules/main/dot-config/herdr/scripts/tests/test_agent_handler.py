"""agent-handler smart-priority ranks and narrowed focus freeze."""
import importlib.util
import os
import sys
import unittest
from unittest import mock

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "agent_handler_ranks", os.path.join(_HERE, "..", "agent-handler.py"))
ah = importlib.util.module_from_spec(_spec)
sys.modules["agent_handler_ranks"] = ah
_spec.loader.exec_module(ah)


def agent(pane, status, seq, focused=False, tokens=None):
    return {"pane_id": pane, "terminal_id": "t" + pane, "agent": "pi",
            "agent_status": status, "state_change_seq": seq,
            "focused": focused, "tokens": tokens or {}}


def legacy(rank, seq):
    return f"{rank}:{999_999_999_999 - seq:012d}"


class RankTest(unittest.TestCase):
    def test_ranks_and_sort_order(self):
        order = ["working", "blocked", "done", "idle", "unknown"]
        self.assertEqual([ah.STATUS_RANK[s] for s in order], list("01234"))
        toks = [ah.sort_token(s, 5) for s in order]
        self.assertEqual(toks, sorted(toks))
        self.assertEqual(len(toks[0]), 17)
        self.assertTrue(toks[0].endswith(":v2"))

    def test_legacy_migration_preserves_captured_status(self):
        for old, status in (("0", "blocked"), ("1", "done"), ("2", "idle"),
                            ("3", "unknown"), ("4", "working")):
            self.assertEqual(ah.usable_sort(legacy(old, 50)), ah.sort_token(status, 50))

    def test_invalid_tokens(self):
        self.assertIsNone(ah.usable_sort("0:%012d:v3" % 5))
        self.assertIsNone(ah.usable_sort("0:%012d:v2" % 999_999_999_999))
        self.assertIsNone(ah.usable_sort("9:%012d:v2" % 5))
        self.assertIsNone(ah.usable_sort("x"))
        self.assertIsNone(ah.usable_sort(None))


class FocusFreezeTest(unittest.TestCase):
    def sync(self, agents, frozen):
        out = {}
        with mock.patch.object(ah, "report_tokens", side_effect=lambda p, t: out.update({p: t})):
            ah.sync_agents(agents, set(), set(), 0, None, frozen)
        return out

    def test_focused_done_to_idle_stays_done(self):
        tok = ah.sort_token("done", 50)
        frozen = {"tp1": tok}
        out = self.sync([agent("p1", "idle", 100, focused=True)], frozen)
        self.assertEqual(frozen["tp1"], tok)
        self.assertEqual(out["p1"][ah.SORT_TOKEN], tok)
        self.assertEqual(out["p1"][ah.RANK_TOKEN], ah.STATUS_RANK["done"])

    def test_prompt_submit_keeps_original_rank_and_seq(self):
        for status in ("idle", "done"):
            tok = ah.sort_token(status, 50)
            frozen = {"tp1": tok}
            out = self.sync([agent("p1", "working", 100, focused=True)], frozen)
            self.assertEqual(frozen["tp1"], tok)
            self.assertEqual(out["p1"][ah.SORT_TOKEN], tok)

    def test_completion_while_focused_keeps_working_rank(self):
        tok = ah.sort_token("working", 50)
        frozen = {"tp1": tok}
        out = self.sync([agent("p1", "done", 100, focused=True)], frozen)
        self.assertEqual(out["p1"][ah.SORT_TOKEN], tok)

    def test_first_sight_captures_server_token(self):
        tok = ah.sort_token("idle", 70)
        frozen = {}
        self.sync([agent("p1", "working", 100, focused=True, tokens={ah.SORT_TOKEN: tok})], frozen)
        self.assertEqual(frozen["tp1"], tok)

    def test_legacy_frozen_token_migrates_captured_status(self):
        frozen = {"tp1": legacy("1", 50)}  # old done
        out = self.sync([agent("p1", "working", 100, focused=True)], frozen)
        self.assertEqual(frozen["tp1"], ah.sort_token("done", 50))
        self.assertEqual(out["p1"][ah.SORT_TOKEN], ah.sort_token("done", 50))

    def test_unfocus_unfreezes_to_live(self):
        frozen = {"tp1": ah.sort_token("done", 50)}
        out = self.sync([agent("p1", "working", 100)], frozen)
        self.assertNotIn("tp1", frozen)
        self.assertEqual(out["p1"][ah.SORT_TOKEN], ah.sort_token("working", 100))

    def test_report_preserves_migrated_captured_token(self):
        pane = agent("p1", "working", 100, tokens={ah.SORT_TOKEN: legacy("1", 50)})
        with mock.patch.object(ah, "report_tokens") as rt:
            ah.report("p1", pane, False)
        self.assertEqual(rt.call_args[0][1][ah.SORT_TOKEN], ah.sort_token("done", 50))


class CandidatesTest(unittest.TestCase):
    def test_working_first_and_close_navigation(self):
        agents = [
            agent("p1", "done", 10, focused=True),
            agent("p2", "working", 20),
            agent("p3", "blocked", 30),
            agent("p4", "idle", 40),
        ]
        # order: p2 working, p3 blocked, p1 done, p4 idle
        self.assertEqual(ah.next_agent_candidates(agents, "p1", mode="smart")[0], "p4")
        self.assertEqual(ah.next_agent_candidates(agents, "p2", mode="smart")[0], "p3")

    def test_focused_frozen_rank_kept_then_unfreezes(self):
        agents = [
            agent("p1", "working", 100, focused=True),
            agent("p2", "idle", 20),
            agent("p3", "done", 30),
        ]
        key = ah.pane_key(agents[0], "p1")
        frozen = {key: ah.sort_token("idle", 50)}
        # p1 frozen as idle (seq 50): order p3 done, p2 idle(20), p1 -> p1 last; closing it -> p2.
        self.assertEqual(
            ah.next_agent_candidates(agents, "p1", frozen=frozen, mode="smart")[0], "p2")
        # Focus left: live working-first order p1, p3, p2 -> closing p1 gives p3 (frozen gave p2).
        agents[0]["focused"] = False
        self.assertEqual(
            ah.next_agent_candidates(agents, "p1", mode="smart")[0], "p3")

    def test_hidden_mode_filters_working_but_keeps_target(self):
        agents = [
            agent("p1", "working", 10, focused=True),
            agent("p2", "working", 20),
            agent("p3", "done", 30),
            agent("p4", "idle", 40),
        ]
        self.assertEqual(
            ah.next_agent_candidates(agents, "p1", mode="hidden"), ["p3", "p4"])

    def test_pinned_first(self):
        agents = [agent("p1", "working", 10, focused=True), agent("p2", "idle", 5),
                  agent("p3", "working", 20)]
        pinned = {ah.pane_key(agents[1], "p2")}
        self.assertEqual(
            ah.next_agent_candidates(agents, "p3", pinned=pinned, mode="smart")[0], "p1")


if __name__ == "__main__":
    unittest.main()
