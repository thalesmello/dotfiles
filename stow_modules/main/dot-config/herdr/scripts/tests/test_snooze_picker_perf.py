"""Snooze popup latency regressions: no live terminals, RPCs or sleeps."""
import importlib.util
import io
import os
from pathlib import Path
import re
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location("snooze_picker_perf", Path(__file__).resolve().parents[1] / "herdr-snooze.py")
snooze = importlib.util.module_from_spec(spec)
spec.loader.exec_module(snooze)


class Terminal:
    rows = 100

    def __init__(self, *keys):
        self.keys = list(keys)
        self.frames = []

    def key(self):
        return snooze.decode_key(self.keys.pop(0)) if self.keys else ("eof", b"")

    def draw(self, lines):
        self.frames.append(list(lines))


def pane(n):
    return {"pane_id": f"p{n}", "terminal_id": f"t{n}", "workspace_id": "sp1",
            "agent": "pi", "agent_status": "idle", "title": f"Agent {n:03d}", "tokens": {}}


class ManagePerformance(unittest.TestCase):
    def setUp(self):
        self.panes = [pane(n) for n in range(30)]
        self.state = snooze.empty_state()
        self.clock = 0.0
        self.backend = self.enterContext(mock.patch.object(snooze.hc_backend(), "enabled", return_value=False))
        self.call = self.enterContext(mock.patch.object(snooze, "call", side_effect=self.rpc))
        self.read = self.enterContext(mock.patch.object(snooze, "read_state", side_effect=lambda: self.state))
        self.enterContext(mock.patch.object(snooze.time, "monotonic", side_effect=lambda: self.clock))

    def rpc(self, method, params=None):
        if method == "pane.list":
            return {"panes": self.panes}
        if method == "workspace.list":
            return {"workspaces": [{"workspace_id": "sp1", "label": "work"}]}
        if method == "snooze.snapshot":
            return {"panes": self.panes, "workspaces": [{"workspace_id": "sp1", "label": "work"}]}
        if method == "agent.focus":
            return {}
        raise AssertionError(method)

    def test_arrows_and_unrecognized_keys_do_not_refetch_model(self):
        term = Terminal(*([b"\x1b[B"] * 20), b"?", b"\x1b")
        snooze.picker_manage(term, {})
        self.assertEqual([c.args[0] for c in self.call.call_args_list], ["pane.list", "workspace.list"])
        self.assertEqual(self.read.call_count, 1)
        self.assertIn("Agent 020", "\n".join(term.frames[-1]))

    def test_app_uses_one_combined_snapshot(self):
        self.backend.return_value = True
        snooze.picker_manage(Terminal(b"\x1b[B", b"\x1b"), {})
        self.call.assert_called_once_with("snooze.snapshot")

    def test_long_list_stays_inside_viewport_and_selection_is_visible(self):
        self.panes = [pane(n) for n in range(100)]
        term = Terminal(*([b"\x1b[6~"] * 12), b"G", b"\x1b")
        term.rows = 12
        snooze.picker_manage(term, {})
        self.assertTrue(all(len(frame) <= term.rows for frame in term.frames))
        last = term.frames[-1]
        selected = [line for line in last if snooze.REVERSE in line]
        self.assertEqual(len(selected), 1)
        self.assertIn("Agent 099", selected[0])
        self.assertIn("more", "\n".join(last))
        self.assertEqual(self.call.call_count, 2)

    def test_idle_refresh_preserves_selected_identity_when_sections_move(self):
        outer = self

        class TimedTerminal(Terminal):
            def wait_key(self, timeout):
                if self.keys[0] == b"timeout":
                    self.keys.pop(0)
                    outer.clock += timeout
                    # The selected p1 moves from Awake to a new Just woke section.
                    outer.state["woke"] = {"p1": {"at": snooze.now_ms(), "reason": "done"}}
                    return "timeout", b""
                return self.key()

        outcome = snooze.picker_manage(TimedTerminal(b"\x1b[B", b"timeout", b"\r"), {})
        self.assertEqual(outcome, "focused p1")
        self.assertEqual(self.read.call_count, 2)
        self.call.assert_any_call("agent.focus", {"target": "p1"})

    def test_wake_invalidates_cached_snapshot(self):
        self.state["panes"] = {"p0": {"until": snooze.now_ms() + 3600000, "via": "pane"}}
        with mock.patch.object(snooze, "wake", side_effect=lambda *a, **kw: self.state["panes"].clear()) as wake:
            snooze.picker_manage(Terminal(b"w", b"\x1b"), {})
        wake.assert_called_once_with({}, pane_ids=["p0"])
        self.assertEqual(self.read.call_count, 2)
        self.assertEqual(self.call.call_count, 4)

    def test_cancelled_nested_picker_restores_list_and_refreshes(self):
        with mock.patch.object(snooze, "picker_for_target", return_value=None) as picker:
            term = Terminal(b"s", b"\x1b")
            snooze.picker_manage(term, {})
        picker.assert_called_once()
        self.assertEqual(self.read.call_count, 2)
        self.assertIn("Agent 000", "\n".join(term.frames[-1]))


class DifferentialDrawing(unittest.TestCase):
    def setUp(self):
        self.term = snooze.RawTerminal()
        self.term.rows, self.term.cols = 12, 80
        self.term.frame = self.term.frame_size = None
        self.term.resize = lambda: None
        self.stream = io.StringIO()
        self.enterContext(mock.patch.object(snooze.sys, "stdout", self.stream))

    def output(self, lines):
        self.stream.seek(0)
        self.stream.truncate()
        self.term.draw(lines)
        return self.stream.getvalue()

    def test_arrows_repaint_only_two_rows_and_never_clear_full_screen(self):
        first = ["Snooze", "", snooze.REVERSE + "first" + snooze.RESET, "second", "footer"]
        self.assertIn("\x1b[2J", self.output(first))
        second = ["Snooze", "", "first", snooze.REVERSE + "second" + snooze.RESET, "footer"]
        delta = self.output(second)
        self.assertNotIn("\x1b[2J", delta)
        self.assertEqual(delta.count("\x1b[2K"), 2)
        self.assertNotIn("Snooze", delta)
        self.assertNotIn("footer", delta)
        self.assertEqual(self.output(second), "")

    def test_shorter_frames_erase_rows_left_by_nested_menu(self):
        self.output(["one", "two", "three"])
        delta = self.output(["one"])
        self.assertIn("\x1b[2;1H\x1b[2K", delta)
        self.assertIn("\x1b[3;1H\x1b[2K", delta)

    def test_resize_forces_one_full_redraw(self):
        self.output(["one", "two"])
        self.term.cols = 40
        self.assertIn("\x1b[2J", self.output(["one", "two"]))
        self.assertEqual(self.output(["one", "two"]), "")

    def test_clipping_accounts_for_ansi_and_wide_unicode(self):
        text = snooze.CYAN + "a界b" + snooze.RESET
        clipped = snooze.clip_ansi(text, 3)
        self.assertEqual(re.sub(r"\x1b\[[0-9;]*m", "", clipped), "a界")
        self.assertTrue(clipped.endswith(snooze.RESET))
        self.assertEqual(snooze.clip_ansi("e\u0301x", 1), "e\u0301" + snooze.RESET)

    def test_emoji_presentation_keycaps_flags_and_joined_glyphs_are_atomic(self):
        for glyph in ("❤️", "1️⃣", "🇧🇷", "👨‍👩‍👧‍👦", "👍🏽"):
            with self.subTest(glyph=glyph):
                self.assertEqual(snooze._cluster_width(glyph), 2)
                self.assertEqual(snooze.clip_ansi(glyph + "x", 2), glyph + snooze.RESET)
                self.assertEqual(snooze.clip_ansi("a" + glyph, 2), "a" + snooze.RESET)

    def test_nested_menu_resize_refreshes_viewport_without_a_navigation_key(self):
        class ResizingTerminal(Terminal):
            rows = 24
            def resize(self):
                pass
            def wait_key(self, timeout):
                if self.keys[0] == b"resize":
                    self.keys.pop(0)
                    self.rows = 9
                    return "timeout", b""
                return self.key()

        term = ResizingTerminal(b"resize", b"\r")
        items = [("", f"option {n}", "") for n in range(20)]
        self.assertEqual(snooze.menu(term, ["header"], items, "footer", selected=9), 9)
        last = term.frames[-1]
        self.assertLessEqual(len(last), 9)
        self.assertIn("option 9", next(line for line in last if snooze.REVERSE in line))

    def test_draw_never_prints_past_last_row(self):
        data = self.output(["row"] * 40)
        self.assertIn("\x1b[12;1H", data)
        self.assertNotIn("\x1b[13;1H", data)

    def test_wait_timeout_is_not_eof_and_queued_keys_never_wait(self):
        self.term.fd = 99
        self.term.pending = []
        with mock.patch("select.select", return_value=([], [], [])), mock.patch.object(self.term, "key") as key:
            self.assertEqual(self.term.wait_key(2), ("timeout", b""))
            key.assert_not_called()
        self.term.pending = [b"j"]
        with mock.patch("select.select") as select, mock.patch.object(self.term, "key", return_value=("down", b"j")):
            self.assertEqual(self.term.wait_key(2), ("down", b"j"))
            select.assert_not_called()


if __name__ == "__main__":
    unittest.main()
