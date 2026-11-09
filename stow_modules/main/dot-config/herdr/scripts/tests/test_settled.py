"""Tests for herdr-settled.py: capture, tail preview, resume commands, rows.

Settled is the archive of closed agent sessions. The invariants that matter:
a closed recorded conversation lands in the registry exactly once and keeps
its first settled_at; a conversation that is live again leaves; the preview
reads only a transcript tail; reopening replays the recorded argv with the
recorded conversation swapped in, in the recorded workspace (recreating it
under the same label when it is gone).
"""

import importlib.util
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "herdr_settled", os.path.join(_HERE, "..", "herdr-settled.py"))
settled = importlib.util.module_from_spec(_spec)
sys.modules["herdr_settled"] = settled
_spec.loader.exec_module(settled)


def pane(pane_id="w1:p1", agent="pi", status="idle", conv="/tmp/a.jsonl", tokens=None, title="Fix it"):
    out = {"pane_id": pane_id, "workspace_id": "w1", "tab_id": "w1:t1",
           "agent": agent, "agent_status": status, "cwd": "/repo",
           "terminal_title_stripped": title, "tokens": tokens or {}}
    if conv:
        out["agent_session"] = {"kind": "path", "value": conv, "source": "herdr:pi"}
    return out


def record(agent="pi", conv="/tmp/a.jsonl", cwd="/repo", argv=None, tab="Fix it"):
    return {"agent": agent, "cwd": cwd, "argv": argv or ["pi", "--session", conv],
            "session": {"kind": "path", "value": conv, "source": "herdr:pi"},
            "identity": {"workspace_id": "w1", "workspace_label": "web",
                         "tab_id": "w1:t1", "tab_label": tab},
            "updated": 1}


WORKSPACES = [{"workspace_id": "w1", "label": "web"}]


class CaptureTest(unittest.TestCase):
    def test_closed_session_settles(self):
        state = settled.capture({"settled": {}, "seen": {}}, {"w1:p1": record()}, [], WORKSPACES, 100.0)
        self.assertIn("/tmp/a.jsonl", state["settled"])
        entry = state["settled"]["/tmp/a.jsonl"]
        self.assertEqual(entry["title"], "Fix it")
        self.assertEqual(entry["settled_at"], 100.0)
        self.assertEqual(entry["workspace_label"], "web")

    def test_live_session_does_not_settle(self):
        state = settled.capture({"settled": {}, "seen": {}}, {"w1:p1": record()}, [pane()], WORKSPACES, 100.0)
        self.assertEqual(state["settled"], {})
        self.assertEqual(state["seen"]["/tmp/a.jsonl"]["title"], "Fix it")

    def test_first_settled_at_is_kept(self):
        first = settled.capture({"settled": {}, "seen": {}}, {"w1:p1": record()}, [], WORKSPACES, 100.0)
        again = settled.capture(first, {"w1:p1": record()}, [], WORKSPACES, 200.0)
        self.assertEqual(again["settled"]["/tmp/a.jsonl"]["settled_at"], 100.0)

    def test_reopened_session_leaves(self):
        state = {"settled": {"/tmp/a.jsonl": {"title": "x", "settled_at": 1.0}}, "seen": {}}
        out = settled.capture(state, {"w1:p1": record()}, [pane()], WORKSPACES, 300.0)
        self.assertEqual(out["settled"], {})

    def test_conversation_live_in_another_pane_does_not_settle(self):
        other = pane(pane_id="w1:p9")
        state = settled.capture({"settled": {}, "seen": {}}, {"w1:p1": record()}, [other], WORKSPACES, 100.0)
        self.assertEqual(state["settled"], {})

    def test_shell_panes_in_store_are_ignored(self):
        state = settled.capture({"settled": {}, "seen": {}}, {"w1:p1": {"agent": ""}}, [], WORKSPACES, 1.0)
        self.assertEqual(state["settled"], {})

    def test_remembered_title_wins_over_tab_label(self):
        seen = {"/tmp/a.jsonl": {"title": "Real title", "workspace_label": "web", "tab_label": ""}}
        entry = settled.entry_from_record("w1:p1", record(tab="Tab name"), seen, 5.0)
        self.assertEqual(entry["title"], "Real title")

    def test_closed_session_keeps_remembered_title_from_prior_state(self):
        # The pane.closed tick runs with the pane already gone from the
        # live list; the title remembered by earlier ticks must survive
        # capture() instead of falling back to the tab label.
        prior = {"settled": {}, "seen": {"/tmp/a.jsonl": {"title": "Real title", "workspace_label": "web", "tab_label": ""}}}
        state = settled.capture(prior, {"w1:p1": record(tab="tab-slug")}, [], WORKSPACES, 100.0)
        self.assertEqual(state["settled"]["/tmp/a.jsonl"]["title"], "Real title")

    def test_live_title_overlays_remembered_title(self):
        prior = {"settled": {}, "seen": {"/tmp/a.jsonl": {"title": "Old title", "workspace_label": "web", "tab_label": ""}}}
        state = settled.capture(prior, {"w1:p1": record()}, [pane(title="New title")], WORKSPACES, 100.0)
        self.assertEqual(state["seen"]["/tmp/a.jsonl"]["title"], "New title")


class TailMessagesTest(unittest.TestCase):
    def write(self, lines):
        handle = tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False, encoding="utf-8")
        for line in lines:
            handle.write(line + "\n")
        handle.close()
        self.addCleanup(os.unlink, handle.name)
        return handle.name

    def test_pi_and_claude_shapes(self):
        path = self.write([
            json.dumps({"type": "message", "message": {"role": "user", "content": "first"}}),
            json.dumps({"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text": "reply"}]}}),
            json.dumps({"type": "message", "message": {"role": "user", "content": "last"}}),
        ])
        self.assertEqual(settled.tail_messages(path, 2), [("assistant", "reply"), ("user", "last")])

    def test_codex_payload_shape(self):
        path = self.write([
            json.dumps({"payload": {"type": "message", "role": "assistant", "content": [{"type": "text", "text": "hi"}]}}),
        ])
        # codex payload messages carry content on the payload itself
        self.assertEqual(settled.tail_messages(path), [("assistant", "hi")])

    def test_bounded_tail_with_partial_first_line(self):
        path = self.write(["x" * 300000] + [
            json.dumps({"type": "message", "message": {"role": "user", "content": "kept"}}),
        ])
        self.assertEqual(settled.tail_messages(path), [("user", "kept")])

    def test_missing_file(self):
        self.assertEqual(settled.tail_messages("/no/such/file.jsonl"), [])

    def test_transcript_title_uses_latest_session_info_beyond_head(self):
        # Pi appends a fresh session_info on every (re)name, well past the
        # first 64 KB; the latest name is the title, not the first.
        path = self.write([
            json.dumps({"type": "session_info", "name": "Early title"}),
            "x" * 70000,
            json.dumps({"type": "session_info", "name": "Later title"}),
        ])
        self.assertEqual(settled.transcript_title(path), "Later title")


class ResumeCommandTest(unittest.TestCase):
    def test_pi_swaps_session(self):
        entry = {"agent": "pi", "argv": ["pi", "--model", "m", "--session", "/tmp/old.jsonl"],
                 "session": {"kind": "path", "value": "/tmp/a.jsonl"}}
        self.assertEqual(settled.resume_command(entry), "pi --model m --session /tmp/a.jsonl")

    def test_claude_replaces_continue(self):
        entry = {"agent": "claude", "argv": ["claude", "--continue"],
                 "session": {"kind": "id", "value": "abc-123"}}
        self.assertEqual(settled.resume_command(entry), "claude --resume abc-123")

    def test_codex_resume_subcommand(self):
        entry = {"agent": "codex", "argv": ["codex", "resume", "old-id"],
                 "session": {"kind": "id", "value": "new-id"}}
        self.assertEqual(settled.resume_command(entry), "codex resume new-id")

    def test_fallback_when_no_conversation_recorded(self):
        entry = {"agent": "pi", "argv": ["pi"], "session": {}}
        self.assertEqual(settled.resume_command(entry), "pi --continue")
        self.assertTrue(settled.is_fallback(entry))

    def test_pi_prompt_after_double_dash_is_stripped(self):
        entry = {"agent": "pi", "argv": ["pi", "--session-id", "old-id", "--", "We're working on X. Details are in @file.md"],
                 "session": {"kind": "path", "value": "/tmp/a.jsonl"}}
        self.assertEqual(settled.resume_command(entry), "pi --session /tmp/a.jsonl")

    def test_replayed_resume_args_do_not_resend_the_prompt(self):
        # argv of a pane a previous reopen started: prompt first, flag after.
        entry = {"agent": "pi", "argv": ["pi", "--", "tell me an unjoke", "--session", "/tmp/a.jsonl"],
                 "session": {"kind": "path", "value": "/tmp/a.jsonl"}}
        self.assertEqual(settled.resume_command(entry), "pi --session /tmp/a.jsonl")

    def test_claude_bare_prompt_is_stripped(self):
        entry = {"agent": "claude", "argv": ["claude", "--model", "m", "fix the thing"],
                 "session": {"kind": "id", "value": "abc-123"}}
        self.assertEqual(settled.resume_command(entry), "claude --model m --resume abc-123")

    def test_claude_print_mode_is_stripped(self):
        entry = {"agent": "claude", "argv": ["claude", "-p", "do a one-shot thing"],
                 "session": {"kind": "id", "value": "abc-123"}}
        self.assertEqual(settled.resume_command(entry), "claude --resume abc-123")

    def test_codex_prompt_is_stripped(self):
        entry = {"agent": "codex", "argv": ["codex", "--model", "m", "fix the bug"],
                 "session": {"kind": "id", "value": "new-id"}}
        self.assertEqual(settled.resume_command(entry), "codex --model m resume new-id")

    def test_flag_value_is_not_mistaken_for_a_prompt(self):
        entry = {"agent": "pi", "argv": ["pi", "--effort", "high", "the prompt"],
                 "session": {"kind": "path", "value": "/tmp/a.jsonl"}}
        self.assertEqual(settled.resume_command(entry), "pi --effort high --session /tmp/a.jsonl")

    def test_bool_flag_does_not_swallow_the_prompt(self):
        entry = {"agent": "claude", "argv": ["claude", "--verbose", "the prompt"],
                 "session": {"kind": "id", "value": "abc-123"}}
        self.assertEqual(settled.resume_command(entry), "claude --verbose --resume abc-123")

    def test_unknown_agent(self):
        self.assertIsNone(settled.resume_command({"agent": "gemini", "argv": ["gemini"], "session": {}}))


class BuildRowsTest(unittest.TestCase):
    def test_sections_and_order(self):
        live = [
            pane("w1:p1", status="working", tokens={"um_pin": "📌"}),
            pane("w1:p2", status="blocked", conv="/tmp/b.jsonl"),
            pane("w1:p3", status="working", conv="/tmp/c.jsonl", tokens={"herdr_snooze": "1"}),
            pane("w1:p4", status="done", conv="/tmp/d.jsonl"),
            pane("w1:p5", status="idle", conv="/tmp/e.jsonl"),
            pane("w1:p6", status="working", conv="/tmp/f.jsonl"),
        ]
        settled_map = {"/tmp/z.jsonl": {"agent": "pi", "title": "Old", "workspace_label": "web", "settled_at": 1.0, "session": {"kind": "path", "value": "/tmp/z.jsonl"}}}
        sections = settled.build_rows(live, WORKSPACES, settled_map)
        names = [name for name, _rows in sections]
        # Group order: blocked > done > idle > working > snoozed > settled,
        # pinned floating above all of it.
        self.assertEqual(names, ["Pinned", "Blocked", "Done", "Idle", "Working", "Snoozed", "Settled"])
        by_name = dict(sections)
        self.assertEqual(by_name["Pinned"][0]["pane_id"], "w1:p1")
        self.assertEqual(by_name["Settled"][0]["kind"], "settled")


class ReopenTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        os.makedirs(os.path.join(self.tmp.name, "repo"), exist_ok=True)
        entry = {"agent": "pi", "cwd": os.path.join(self.tmp.name, "repo"),
                 "argv": ["pi"], "session": {"kind": "path", "value": "/tmp/a.jsonl"},
                 "workspace_id": "wGONE", "workspace_label": "web", "title": "Fix it"}
        self.state = {"settled": {"/tmp/a.jsonl": entry}, "seen": {}}
        self.calls = []

    def fake_call(self, method, params=None, timeout=5.0):
        self.calls.append((method, params or {}))
        if method == "pane.list":
            return {"panes": []}
        if method == "workspace.list":
            return {"workspaces": []}
        if method == "workspace.create":
            return {"workspace": {"workspace_id": "w9", "label": params["label"]}}
        if method == "tab.create":
            return {"tab": {"tab_id": "w9:t1"}, "root_pane": {"pane_id": "w9:p1"}}
        if method in ("pane.send_text", "pane.send_keys"):
            return {}
        raise AssertionError(method)

    def test_reopen_recreates_workspace_with_recorded_label(self):
        with mock.patch.object(settled, "call", self.fake_call), \
                mock.patch.object(settled, "read_registry", return_value=json.loads(json.dumps(self.state))), \
                mock.patch.object(settled, "write_registry") as write:
            outcome = settled.reopen("/tmp/a.jsonl")
        self.assertEqual(outcome, "reopened in w9:p1")
        created = [p for m, p in self.calls if m == "workspace.create"]
        self.assertEqual(created[0]["label"], "web")
        ran = [p for m, p in self.calls if m == "pane.send_text"]
        self.assertEqual(ran[0]["text"], "pi --session /tmp/a.jsonl")
        keys = [p for m, p in self.calls if m == "pane.send_keys"]
        self.assertEqual(keys[0]["keys"], ["enter"])
        self.assertEqual(write.call_args[0][0]["settled"], {})

    def test_reopen_jumps_to_already_open_conversation(self):
        live = pane(conv="/tmp/a.jsonl")
        def fake(method, params=None, timeout=5.0):
            self.calls.append((method, params or {}))
            if method == "pane.list":
                return {"panes": [live]}
            if method == "agent.focus":
                return {}
            raise AssertionError(method)
        with mock.patch.object(settled, "call", fake), \
                mock.patch.object(settled, "read_registry", return_value=self.state):
            outcome = settled.reopen("/tmp/a.jsonl")
        self.assertIn("already open", outcome)


class SettlePaneTest(unittest.TestCase):
    def test_settle_freezes_then_closes(self):
        calls = []

        def fake(method, params=None, timeout=5.0):
            calls.append((method, params or {}))
            if method == "pane.list":
                return {"panes": [pane()]}
            if method == "workspace.list":
                return {"workspaces": WORKSPACES}
            if method == "pane.close":
                return {}
            raise AssertionError(method)

        written = {}
        with mock.patch.object(settled, "call", fake), \
                mock.patch.object(settled, "read_store", return_value={"w1:p1": record()}), \
                mock.patch.object(settled, "read_registry", return_value={"settled": {}, "seen": {}}), \
                mock.patch.object(settled, "write_registry", side_effect=lambda s: written.update(s)):
            outcome = settled.settle_pane("w1:p1")
        self.assertTrue(outcome.startswith("settled"))
        self.assertIn("/tmp/a.jsonl", written["settled"])  # frozen before the close
        self.assertEqual(calls[-1], ("pane.close", {"pane_id": "w1:p1"}))

    def test_settle_refuses_a_shell_pane(self):
        shell = pane()
        shell["agent"] = ""
        with mock.patch.object(settled, "call", return_value={"panes": [shell]}):
            self.assertIn("no agent", settled.settle_pane("w1:p1"))

    def test_settle_session_freezes_previous_conversation_without_closing_pane(self):
        calls = []
        # The pane is already on the new session (/tmp/new.jsonl), while its
        # terminal title still shows the previous session's title before reset.
        live_pane = pane(conv="/tmp/new.jsonl", title="Previous Conversation Title")

        def fake(method, params=None, timeout=5.0):
            calls.append((method, params or {}))
            if method == "pane.list":
                return {"panes": [live_pane]}
            if method == "workspace.list":
                return {"workspaces": WORKSPACES}
            raise AssertionError(method)

        written = {}
        with mock.patch.object(settled, "call", fake), \
                mock.patch.object(settled, "read_store", return_value={"w1:p1": record(conv="/tmp/new.jsonl")}), \
                mock.patch.object(settled, "read_registry", return_value={"settled": {}, "seen": {}}), \
                mock.patch.object(settled, "write_registry", side_effect=lambda s: written.update(s)):
            outcome = settled.settle_session("w1:p1", "/tmp/old.jsonl")
        self.assertTrue(outcome.startswith("settled"))
        self.assertIn("/tmp/old.jsonl", written["settled"])
        self.assertNotIn("/tmp/new.jsonl", written["settled"])
        self.assertEqual(written["seen"].get("/tmp/new.jsonl", {}).get("title"), "")
        entry = written["settled"]["/tmp/old.jsonl"]
        self.assertEqual(entry["title"], "Previous Conversation Title")
        self.assertEqual(entry["workspace_label"], "web")
        self.assertEqual(entry["session"]["value"], "/tmp/old.jsonl")
        self.assertFalse(any(m == "pane.close" for m, _p in calls))

    def test_settle_session_on_resume_un_settles_the_resumed_conversation(self):
        # Resuming /tmp/resumed.jsonl from /tmp/current.jsonl: /tmp/current.jsonl
        # enters settled, and /tmp/resumed.jsonl leaves settled since it is now live.
        live_pane = pane(conv="/tmp/resumed.jsonl", title="Current Title")
        prior_state = {
            "settled": {"/tmp/resumed.jsonl": {"title": "Resumed Work", "settled_at": 10.0}},
            "seen": {},
        }
        written = {}
        with mock.patch.object(settled, "call", side_effect=lambda m, p=None, timeout=5.0: {"panes": [live_pane]} if m == "pane.list" else {"workspaces": WORKSPACES}), \
                mock.patch.object(settled, "read_store", return_value={"w1:p1": record(conv="/tmp/resumed.jsonl")}), \
                mock.patch.object(settled, "read_registry", return_value=prior_state), \
                mock.patch.object(settled, "write_registry", side_effect=lambda s: written.update(s)):
            settled.settle_session("w1:p1", "/tmp/current.jsonl")
        self.assertIn("/tmp/current.jsonl", written["settled"])
        self.assertNotIn("/tmp/resumed.jsonl", written["settled"])
        self.assertEqual(written["settled"]["/tmp/current.jsonl"]["title"], "Current Title")

    def test_settle_session_survives_subsequent_tick(self):
        live_pane = pane(conv="/tmp/new.jsonl", title="π - repo")
        state = {"settled": {}, "seen": {"/tmp/old.jsonl": {"title": "Old Work", "workspace_label": "web", "tab_label": ""}}}
        with mock.patch.object(settled, "call", side_effect=lambda m, p=None, timeout=5.0: {"panes": [live_pane]} if m == "pane.list" else {"workspaces": WORKSPACES}), \
                mock.patch.object(settled, "read_store", return_value={"w1:p1": record(conv="/tmp/old.jsonl")}), \
                mock.patch.object(settled, "read_registry", return_value=state), \
                mock.patch.object(settled, "write_registry", side_effect=lambda s: state.update(s)):
            settled.settle_session("w1:p1", "/tmp/old.jsonl")
        self.assertIn("/tmp/old.jsonl", state["settled"])
        self.assertEqual(state["settled"]["/tmp/old.jsonl"]["title"], "Old Work")
        # A subsequent tick with the pane now on /tmp/new.jsonl keeps /tmp/old.jsonl settled.
        after_tick = settled.capture(state, {"w1:p1": record(conv="/tmp/new.jsonl")}, [live_pane], WORKSPACES, 999.0)
        self.assertIn("/tmp/old.jsonl", after_tick["settled"])
        self.assertEqual(after_tick["settled"]["/tmp/old.jsonl"]["title"], "Old Work")


class PickerDrawTest(unittest.TestCase):
    class FakeTerm:
        rows, cols = 20, 100

        def __init__(self):
            self.lines = None

        def draw(self, lines):
            self.lines = lines

    def test_tab_bar_and_status_bar_are_fixed(self):
        picker = settled.Picker.__new__(settled.Picker)
        picker.selected = 0
        picker.marked = set()
        picker.flash = ""
        picker.preview_cache = {}
        picker.filter = "all"
        picker.query = ""
        picker.searching = False
        picker.confirm = None
        picker.show_help = True
        live = [pane("w1:p%d" % i, conv="/tmp/%d.jsonl" % i, title="Session %d" % i) for i in range(30)]
        picker.sections = settled.build_rows(live, WORKSPACES, {})
        picker.apply_view()
        term = self.FakeTerm()
        for selected in (0, 15, 29):
            picker.selected = selected
            picker.draw(term)
            self.assertEqual(len(term.lines), term.rows)          # one full fixed frame
            self.assertFalse(any("Sessions" in line for line in term.lines))  # no in-content heading; the popup is named instead
            self.assertTrue(any("Shortcuts" in line for line in term.lines))  # cheatsheet: right sidebar only
            self.assertIn("enter jumps to the pane", term.lines[-1])  # status bar: last line
            self.assertFalse(any("Shortcuts" in line for line in term.lines[-4:]))  # never in the bottom block
        self.assertTrue(any("Session 29" in line for line in term.lines))  # selection scrolled into the window

    def test_help_hidden_by_default_and_hint_in_corner(self):
        picker = settled.Picker.__new__(settled.Picker)
        picker.selected = 0
        picker.marked = set()
        picker.flash = ""
        picker.preview_cache = {}
        picker.filter = "settled"
        picker.query = ""
        picker.searching = False
        picker.confirm = None
        picker.show_help = False
        picker.sections = settled.build_rows([pane()], WORKSPACES, {})
        picker.apply_view()
        term = self.FakeTerm()
        picker.draw(term)
        self.assertFalse(any("Shortcuts" in line for line in term.lines))
        self.assertIn("? for help", term.lines[-1])


class FilterTest(unittest.TestCase):
    def sections(self):
        live = [
            pane("w1:p1", status="blocked", conv="/tmp/a.jsonl", title="Alpha"),
            pane("w1:p2", status="done", conv="/tmp/b.jsonl", title="Beta"),
            pane("w1:p3", status="idle", conv="/tmp/c.jsonl", title="Gamma"),
            pane("w1:p4", status="working", conv="/tmp/d.jsonl", title="Delta"),
            pane("w1:p5", status="working", conv="/tmp/e.jsonl", title="Epsilon", tokens={"herdr_snooze": "1"}),
        ]
        old = {"/tmp/z.jsonl": {"agent": "pi", "title": "Zeta", "workspace_label": "web", "settled_at": 1.0, "session": {"kind": "path", "value": "/tmp/z.jsonl"}}}
        return settled.build_rows(live, WORKSPACES, old)

    def names(self, sections):
        return [name for name, _rows in sections]

    def test_filter_keys(self):
        self.assertEqual(settled.FILTER_KEYS["S"], "settled")
        self.assertEqual(settled.FILTER_KEYS["Z"], "snoozed")
        self.assertEqual(settled.FILTER_KEYS["A"], "all")

    def test_doneidle_filter_combines_done_and_idle(self):
        self.assertEqual(self.names(settled.visible_sections(self.sections(), "doneidle")), ["Done", "Idle"])

    def test_single_group_filters(self):
        self.assertEqual(self.names(settled.visible_sections(self.sections(), "snoozed")), ["Snoozed"])
        self.assertEqual(self.names(settled.visible_sections(self.sections(), "settled")), ["Settled"])
        self.assertEqual(self.names(settled.visible_sections(self.sections(), "working")), ["Working"])

    def test_search_matches_titles_across_groups(self):
        found = settled.visible_sections(self.sections(), "all", "et")
        titles = [r["title"] for _n, rows in found for r in rows]
        self.assertEqual(titles, ["Beta", "Zeta"])

    def test_search_and_filter_combine(self):
        found = settled.visible_sections(self.sections(), "doneidle", "gamma")
        self.assertEqual(self.names(found), ["Idle"])


class PickerMarkAndConfirmTest(unittest.TestCase):
    def make_picker(self, rows):
        picker = settled.Picker.__new__(settled.Picker)
        picker.selected = 0
        picker.marked = set()
        picker.flash = ""
        picker.preview_cache = {}
        picker.filter = "all"
        picker.query = ""
        picker.searching = False
        picker.confirm = None
        picker.show_help = False
        picker.rows = rows
        picker.reload = lambda: None
        return picker

    def test_marked_row_uses_background_not_checkmark(self):
        row = pane()
        picker = self.make_picker([row])
        picker.sections = settled.build_rows([row], WORKSPACES, {})
        picker.display_sections = picker.sections
        picker.marked = {row["pane_id"]}
        term = PickerDrawTest.FakeTerm()
        picker.draw(term)
        joined = "".join(term.lines)
        self.assertIn(settled.MARK_BG, joined)
        self.assertNotIn("✓", joined)

    def row_line(self, picker, term, needle="Fix it"):
        picker.draw(term)
        return next(l for l in term.lines if needle in l)

    def test_cursor_highlights_only_the_title(self):
        row = pane()
        picker = self.make_picker([row])
        picker.sections = settled.build_rows([row], WORKSPACES, {})
        picker.display_sections = picker.sections
        line = self.row_line(picker, PickerDrawTest.FakeTerm())
        between = line.split(settled.REVERSE)[1].split(settled.RESET)[0]
        self.assertEqual(between, "Fix it")       # title only, not the detail
        self.assertNotIn(settled.MARK_BG, line)

    def test_marked_background_survives_the_cursor(self):
        row = pane()
        picker = self.make_picker([row])
        picker.sections = settled.build_rows([row], WORKSPACES, {})
        picker.display_sections = picker.sections
        picker.marked = {row["pane_id"]}
        picker.selected = 0
        line = self.row_line(picker, PickerDrawTest.FakeTerm())
        self.assertIn(settled.MARK_BG, line)      # same wash as an unselected mark
        between = line.split(settled.REVERSE)[1].split(settled.RESET)[0]
        self.assertEqual(between, "Fix it")       # and the cursor is still title-only

    def test_right_columns_align_across_rows(self):
        live = [pane("w1:p1", title="One"), pane("w1:p2", agent="claude", status="done", conv="/tmp/b.jsonl", title="Two")]
        workspaces = [{"workspace_id": "w1", "label": "web"}, {"workspace_id": "w2", "label": "a-much-longer-name"}]
        live[1]["workspace_id"] = "w2"
        sections = settled.build_rows(live, workspaces, {})
        picker = self.make_picker([r for _n, rows in sections for r in rows])
        picker.sections = sections
        picker.display_sections = sections
        term = PickerDrawTest.FakeTerm()
        picker.draw(term)
        import re as _re
        lines = [_re.sub(r"\x1b\[[0-9;]*[a-zA-Z]", "", l) for l in term.lines if "One" in l or "Two" in l]
        self.assertEqual(len(lines), 2)
        # agent column starts at the same offset on both rows, rows end together
        one = next(l for l in lines if "One" in l)
        two = next(l for l in lines if "Two" in l)
        self.assertEqual(one.index("pi"), two.index("claude"))
        self.assertEqual(len(one), len(two))  # padded to the same right edge (age column blank)

    def test_transcript_gone_is_a_bottom_note_not_a_column(self):
        old = {"/tmp/gone.jsonl": {"agent": "pi", "title": "Gone", "workspace_label": "web", "settled_at": 1.0, "session": {"kind": "path", "value": "/tmp/gone.jsonl"}}}
        sections = settled.build_rows([], WORKSPACES, old)
        picker = self.make_picker([sections[0][1][0]])
        picker.sections = sections
        picker.display_sections = sections
        picker.selected = 0
        term = PickerDrawTest.FakeTerm()
        picker.draw(term)
        row_line = next(l for l in term.lines if "Gone" in l)
        self.assertNotIn("transcript gone", row_line)          # not in the row columns
        self.assertNotIn("transcript gone", "".join(term.lines[-5:-1]))  # not in the messages block
        self.assertIn("transcript gone", term.lines[-1])        # in the status bar, when highlighted

    def test_settle_asks_before_closing(self):
        sections = settled.build_rows([pane()], WORKSPACES, {})
        row = sections[0][1][0]
        picker = self.make_picker([row])
        with mock.patch.object(settled, "settle_pane", return_value="settled Fix it") as settle_mock:
            picker.act("settle", picker.rows[0])
            settle_mock.assert_not_called()          # nothing closed yet
            self.assertIsNotNone(picker.confirm)
            picker.confirm_settle()
            settle_mock.assert_called_once_with(row["pane_id"])
        self.assertIsNone(picker.confirm)

    def test_settle_can_be_cancelled(self):
        sections = settled.build_rows([pane()], WORKSPACES, {})
        picker = self.make_picker([sections[0][1][0]])
        picker.act("settle", picker.rows[0])
        picker.cancel_confirm()
        self.assertIsNone(picker.confirm)
        self.assertIn("cancelled", picker.flash)


class KeyCoalesceTest(unittest.TestCase):
    def make_term(self, data):
        read_fd, write_fd = os.pipe()
        os.write(write_fd, data)
        os.close(write_fd)
        term = settled.RawTerminal.__new__(settled.RawTerminal)
        term.fd = read_fd
        term.pending = []
        self.addCleanup(os.close, read_fd)
        return term

    def test_peek_does_not_consume(self):
        term = self.make_term(b"jjq")
        self.assertEqual(term.peek_key()[0], "down")
        self.assertEqual(term.peek_key()[0], "down")
        self.assertEqual(term.key()[0], "down")
        self.assertEqual(term.key()[0], "down")
        self.assertEqual(term.key()[0], "esc")   # q decodes as esc (close)

    def test_draw_does_not_full_clear(self):
        import io
        term = settled.RawTerminal.__new__(settled.RawTerminal)
        with mock.patch.object(settled.sys, "stdout", io.StringIO()) as out:
            settled.RawTerminal.draw(term, ["a", "b"])
        self.assertNotIn("\x1b[2J", out.getvalue())
        self.assertTrue(out.getvalue().startswith("\x1b[H"))


class FilterWorkerTest(unittest.TestCase):
    def test_worker_computes_off_thread_and_coalesces(self):
        sections = FilterTest("test_single_group_filters").sections()
        worker = settled.FilterWorker()
        self.addCleanup(worker.close)
        worker.request(sections, "all", "e")
        worker.request(sections, "all", "et")
        gen = worker.request(sections, "doneidle", "gamma")
        deadline = __import__("time").time() + 5
        finished = None
        while __import__("time").time() < deadline:
            finished = worker.poll()
            if finished and finished[0] == gen:
                break
            __import__("time").sleep(0.005)
        self.assertIsNotNone(finished)
        self.assertEqual([n for n, _r in finished[1]], ["Idle"])  # only the latest job matters

    def test_build_rows_precomputes_search_haystacks(self):
        rows = settled.build_rows([pane()], WORKSPACES, {})
        self.assertIn("fix it", rows[0][1][0]["_search"])


class NameSelfTest(unittest.TestCase):
    def test_picker_names_its_popup_agent_sessions(self):
        with mock.patch.object(settled, "call") as call_mock, \
                mock.patch.dict(os.environ, {"HERDR_PANE_ID": "w1:p9"}):
            settled.name_self()
        call_mock.assert_called_once_with("pane.rename", {"pane_id": "w1:p9", "label": "Agent Sessions"})

    def test_no_pane_env_is_quiet(self):
        with mock.patch.object(settled, "call") as call_mock, \
                mock.patch.dict(os.environ, {}, clear=True):
            settled.name_self()
        call_mock.assert_not_called()


class OpenPickerTest(unittest.TestCase):
    def test_open_uses_the_named_plugin_pane(self):
        with mock.patch.object(settled, "call") as call_mock:
            self.assertEqual(settled.open_picker(), 0)
        params = call_mock.call_args[0][1]
        self.assertEqual(params["plugin_id"], "herdr-settled")
        self.assertEqual(params["placement"], "popup")

    def test_open_reports_a_busy_ui_instead_of_failing_silently(self):
        with mock.patch.object(settled, "call", side_effect=settled.HerdrError("ui_busy", "a popup pane is already open")), \
                mock.patch.object(settled, "notify") as notify_mock:
            self.assertEqual(settled.open_picker(), 1)
        notify_mock.assert_called_once()


class HandoffTest(unittest.TestCase):
    def test_handoff_opens_the_snooze_picker(self):
        calls = []
        with mock.patch.object(settled, "call", side_effect=lambda m, p=None, timeout=5.0: calls.append((m, p)) or {}), \
                mock.patch.object(settled.time, "sleep"):
            self.assertEqual(settled.handoff_snooze(), 0)
        self.assertEqual(calls[0][0], "plugin.pane.open")
        self.assertEqual(calls[0][1]["plugin_id"], "herdr-snooze")


if __name__ == "__main__":
    unittest.main()
