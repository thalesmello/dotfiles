"""Tests for scripts/herdr-recap.py.

Translated from the upstream Go tests in mrolafsson/herdr-recap
(title_test.go, stage_test.go, search_test.go, meta_test.go,
recap_test.go), adapted to the Python port's shapes. Cases are kept;
harness-only parts (Bubble Tea models, fake sources) are left out.
Pi cases come from the local Pi addition (mirroring pi_test.go upstream
style, written for this port).
"""

import importlib.util
import json
import os
import sys
import tempfile
import unittest

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "herdr_recap", os.path.join(_HERE, "..", "herdr-recap.py"))
rc = importlib.util.module_from_spec(_spec)
sys.modules["herdr_recap"] = rc
_spec.loader.exec_module(rc)


class TicketKeyTest(unittest.TestCase):
    def test_cases(self):
        cases = {
            "mrolafsson-act-1921-users-that-are-immediately-activated": "ACT-1921",
            "mrolafsson/the-30-invitations-can-be-reissued": "THE-30",
            "ACT-7": "ACT-7",
            "fix/checkout-flake": "",
            "main": "",
            "project-phase-0-substrate-c2c2de2dae78": "",
            "phase-2-web-88-rate-limits": "WEB-88",
            "release-3": "",
            "project-morning-brief-update-689e9d59115": "",
            "": "",
        }
        for branch, want in cases.items():
            with self.subTest(branch=branch):
                self.assertEqual(rc.ticket_key(branch), want)


class PoorTitleTest(unittest.TestCase):
    def test_cases(self):
        cases = [
            ("", "main", True),
            ("Claude Code", "main", True),
            ("fix-channelless-assignment-notify", "main", True),
            ("review_merge_before_push", "main", True),
            ("Sensor improvements", "project-sensors-overhaul-3b30ce3f1ec4", False),
            ("scratch", "main", False),
            ("PR 2 voices", "mrolafsson-act-1870-review-jira-sensors", True),
            ("act-1870 Jira sensors on a par", "mrolafsson-act-1870-review-jira-sensors", False),
            ("Phase 0 substrate", "project-phase-0-substrate-c2c2de2dae78", False),
        ]
        for title, branch, want in cases:
            with self.subTest(title=title):
                self.assertEqual(rc.poor_title(title, branch), want)


class CleanTitleTest(unittest.TestCase):
    def test_cases(self):
        good = {
            "ACT-1921 Activation Email for New Users": "ACT-1921 Activation Email for New Users",
            '"ACT-1921  Activation Email"': "ACT-1921 Activation Email",
            "**Fix the Flaky Checkout Test.**": "Fix the Flaky Checkout Test",
            "Fix \x1b]52;c;aGk=\x07Login": "Fix Login",
        }
        for raw, want in good.items():
            with self.subTest(raw=raw):
                self.assertEqual(rc.clean_title(raw), want)
        for raw in ("Here is a name:\nACT-1921 Activation Email", "/clear", "",
                    "A title that goes on and on " + "and on " * 8):
            with self.subTest(raw=raw):
                with self.assertRaises(Exception):
                    rc.clean_title(raw)


class StageTest(unittest.TestCase):
    def entry(self, status="idle", tokens=None, files=0, ahead=0):
        agent = rc.AgentInfo(pane_id="w1:p1", agent="claude", status=status, tokens=tokens or {})
        entry = rc.Entry(agent=agent)
        entry.changes = rc.GitChanges(files=files, ahead=ahead)
        return entry

    def test_status_wins(self):
        self.assertEqual(rc.stage_of(self.entry("blocked")), "needs-you")
        self.assertEqual(rc.stage_of(self.entry("done")), "done")
        self.assertEqual(rc.stage_of(self.entry("working")), "working")
        self.assertEqual(rc.stage_of(self.entry("idle")), "idle")

    def test_pr_stages(self):
        self.assertEqual(rc.stage_of(self.entry(tokens={"pr_state": "open"})), "review")
        self.assertEqual(rc.stage_of(self.entry(tokens={"pr_state": "draft"})), "idle")
        self.assertEqual(rc.stage_of(self.entry(tokens={"pr_state": "open", "pr_checks": "✗"})), "fixing")
        self.assertEqual(rc.stage_of(self.entry(tokens={"pr_state": "open", "pr_review": "changes requested"})), "fixing")
        self.assertEqual(rc.stage_of(self.entry(tokens={"pr_state": "merged"})), "merged")
        self.assertEqual(rc.stage_of(self.entry(tokens={"pr_state": "closed"})), "merged")

    def test_new_work_after_merge_is_idle(self):
        self.assertEqual(rc.stage_of(self.entry(tokens={"pr_state": "merged"}, files=2)), "idle")
        self.assertEqual(rc.stage_of(self.entry(tokens={"pr_state": "merged"}, ahead=1)), "idle")

    def test_snoozed_wins_over_status(self):
        entry = self.entry("working", tokens={rc.SNOOZE_MARK: "1"})
        self.assertEqual(rc.stage_of(entry), "snoozed")


class SearchTest(unittest.TestCase):
    def test_finder_needs_every_word(self):
        finder = rc.Finder(["cart", "race"])
        finder.see("the cart animation takes 300ms")
        self.assertEqual(finder.snippet(), "")
        finder.see("it raced the cart animation")
        self.assertIn("cart", finder.snippet())

    def test_word_index_prefers_whole_words(self):
        self.assertGreaterEqual(rc.word_index("the cart total", "cart"), 0)
        self.assertEqual(rc.word_index("withdrawn", "raw"), -1)
        self.assertGreaterEqual(rc.word_index("raw file", "raw"), 0)

    def test_search_words_min_length(self):
        self.assertEqual(rc.search_words("ab"), [])
        self.assertEqual(rc.search_words("dark mode"), ["dark", "mode"])

    def test_search_transcript_reads_only_speech(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "s.jsonl")
            records = [
                {"type": "user", "message": {"role": "user", "content": "playwright retries"}},
                {"type": "assistant", "message": {"role": "assistant", "content": [
                    {"type": "tool_use", "name": "Read", "input": {"file_path": "/x/playwright.md"}},
                    {"type": "text", "text": "use toHaveText so playwright retries"}]}},
            ]
            with open(path, "w") as handle:
                for record in records:
                    handle.write(json.dumps(record) + "\n")
            found = rc.search_transcript(path, ["playwright"])
            self.assertIn("toHaveText", found)


class MetaTest(unittest.TestCase):
    def test_pending_text(self):
        self.assertEqual(rc.pending_text("Bash", {"command": "make test"}), "Run make test")
        self.assertEqual(rc.pending_text("ExitPlanMode", {}), "Approve its plan?")
        self.assertEqual(rc.pending_text("Edit", {"file_path": "/a/b/c.py"}), "Edit c.py")
        self.assertEqual(rc.pending_text("Write", {"file_path": "/a/notes.md"}), "Write notes.md")
        self.assertEqual(rc.pending_text("AskUserQuestion", {"questions": [{"question": "Ship it?"}]}), "Ship it?")
        self.assertEqual(rc.pending_text("WebSearch", {"query": "herdr"}), "Search the web for herdr")
        self.assertEqual(rc.pending_text("mcp__github__create_issue", {}), "Use create_issue (github)")

    def test_short_model(self):
        self.assertEqual(rc.short_model("claude-opus-5-5"), "opus 5.5")
        self.assertEqual(rc.short_model("claude-haiku-4-5-20251001"), "haiku 4.5")
        self.assertEqual(rc.short_model("gemini-x"), "gemini x")


class RecapParseTest(unittest.TestCase):
    def test_parse_recap(self):
        out = json.dumps({"is_error": False, "result": "Fixed the thing.  Next: push it.",
                          "total_cost_usd": 0.02})
        text, cost = rc.parse_recap(out)
        self.assertEqual(text, "Fixed the thing. Next: push it.")
        self.assertEqual(cost, 0.02)

    def test_parse_recap_nothing_yet(self):
        out = json.dumps({"is_error": False, "result": "Nothing to recap yet.", "total_cost_usd": 0})
        with self.assertRaises(rc.NothingYet):
            rc.parse_recap(out)

    def test_agent_env_is_a_dict_without_herdr_vars(self):
        session = rc.AgentSession(agent="pi", path="/usr/bin:/bin", config_dir="/cfg/claude", config_dir_set=True)
        env = rc.agent_env(session, "CLAUDE_CONFIG_DIR")
        self.assertIsInstance(env, dict)
        self.assertEqual(env["PATH"], "/usr/bin:/bin")
        self.assertEqual(env["CLAUDE_CONFIG_DIR"], "/cfg/claude")
        self.assertFalse(any(k.startswith("HERDR_") for k in env))


PI_TRANSCRIPT = "\n".join([
    '{"type":"session","version":3,"id":"e5824072-fd55-4a4a-8faa-50a2db0b62f9","timestamp":"2026-10-26T20:49:24.473Z","cwd":"/work/repo"}',
    '{"type":"model_change","id":"m1","timestamp":"2026-10-26T20:49:24.768Z","provider":"google","modelId":"gemini-x"}',
    '{"type":"message","id":"1","timestamp":"2026-10-26T20:49:25.000Z","message":{"role":"user","content":[{"type":"text","text":"fix the flaky test"}]}}',
    '{"type":"message","id":"2","timestamp":"2026-10-26T20:49:30.000Z","message":{"role":"assistant","model":"gemini-x","content":[{"type":"thinking","thinking":"secret reasoning"},{"type":"text","text":"Found the race."},{"type":"toolCall","id":"t1","name":"bash","arguments":{}}]}}',
    '{"type":"message","id":"3","timestamp":"2026-10-26T20:49:31.000Z","message":{"role":"system","content":"ignore me"}}',
]) + "\n"


class PiTest(unittest.TestCase):
    def write_transcript(self, directory):
        path = os.path.join(directory, "2026-10-26T20-49-24-473Z_e5824072-fd55-4a4a-8faa-50a2db0b62f9.jsonl")
        with open(path, "w") as handle:
            handle.write(PI_TRANSCRIPT)
        return path

    def test_capable(self):
        cfg = rc.Config()
        agent = rc.AgentInfo(agent="pi", agent_session={"kind": "path", "value": "/x/s.jsonl"})
        self.assertTrue(rc.recap_capable(cfg, agent))
        self.assertFalse(rc.recap_capable(cfg, rc.AgentInfo(agent="pi")))
        self.assertFalse(rc.recap_capable(rc.Config(agents=["claude"]), agent))

    def test_conversation_only_spoken(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.write_transcript(directory)
            session = rc.AgentSession(agent="pi", id="x", transcript=path)
            text = rc.transcript_conversation(session, 24000)
            self.assertIn("USER: fix the flaky test", text)
            self.assertIn("ASSISTANT: Found the race.", text)
            self.assertNotIn("secret reasoning", text)
            self.assertNotIn("ignore me", text)

    def test_freshness_uses_transcript_stamp(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.write_transcript(directory)
            session = rc.AgentSession(agent="pi", id="e5824072-fd55-4a4a-8faa-50a2db0b62f9", transcript=path)
            size, mod = rc.transcript_stamp(path)
            recap = rc.Recap(session=session.id, source="pi", text="done", size=size, mod_time=mod)
            self.assertTrue(rc.recap_fresh(recap, session))
            with open(path, "a") as handle:
                handle.write('{"type":"message","message":{"role":"user","content":"more"}}\n')
            self.assertFalse(rc.recap_fresh(recap, session))


class EscapeTest(unittest.TestCase):
    def make_model(self):
        model = rc.Model(rc.Config())
        self.addCleanup(model.executor.shutdown, wait=False)
        return model

    def test_esc_closes_even_with_filter_and_stage(self):
        model = self.make_model()
        model.filter, model.filter_cursor, model.show = "dark", 4, "working"
        self.assertEqual(model.handle_key("esc"), "quit")

    def test_esc_in_reply_cancels_reply_first(self):
        model = self.make_model()
        entry = rc.Entry(agent=rc.AgentInfo(pane_id="w1:p1", agent="pi"))
        model.entries["w1:p1"] = entry
        model.order = ["w1:p1"]
        model.start_reply()
        self.assertTrue(model.replying)
        self.assertIsNone(model.handle_key("esc"))
        self.assertFalse(model.replying)
        self.assertEqual(model.handle_key("esc"), "quit")


class DecoderTest(unittest.TestCase):
    def test_kitty_csi_u_keys(self):
        decoder = rc.Decoder()
        self.assertEqual(decoder.feed(b"\x1b[27u"), [("key", "esc")])
        self.assertEqual(decoder.feed(b"\x1b[13u"), [("key", "enter")])
        self.assertEqual(decoder.feed(b"\x1b[127u"), [("key", "backspace")])
        self.assertEqual(decoder.feed(b"\x1b[107;7u"), [("key", "ctrl+alt+k")])
        self.assertEqual(decoder.feed(b"a"), [("char", "a")])

    def test_kitty_release_is_ignored(self):
        decoder = rc.Decoder()
        self.assertEqual(decoder.feed(b"\x1b[27;1:3u"), [])

    def test_bare_escape_resolves_on_flush(self):
        decoder = rc.Decoder()
        self.assertEqual(decoder.feed(b"\x1b"), [])
        self.assertTrue(decoder.pending_escape())
        self.assertEqual(decoder.flush(), [("key", "esc")])


if __name__ == "__main__":
    unittest.main()


class DrawTest(unittest.TestCase):
    def test_frame_erases_below_and_clears_on_resize(self):
        import io
        from unittest import mock
        term = rc.RawTerminal.__new__(rc.RawTerminal)
        term.fd = 1
        term.saved = None
        term._last_size = None
        out = io.StringIO()
        with mock.patch.object(rc.sys, "stdout", out):
            term.draw(["a", "b", "c", "d", "footer"], 80, 5)
            first = out.getvalue()
            out.seek(0)
            out.truncate()
            term.draw(["a", "footer"], 80, 3)  # shrunk: stale rows below
            second = out.getvalue()
            out.seek(0)
            out.truncate()
            term.draw(["a", "footer"], 80, 3)  # same size: no full clear
            third = out.getvalue()
        self.assertIn("\x1b[2J", first)
        self.assertIn("\x1b[2J", second)
        self.assertNotIn("\x1b[2J", third)
        for frame in (first, second, third):
            self.assertTrue(frame.endswith("\x1b[0m\x1b[J"))


class ViewHeightTest(unittest.TestCase):
    def make_model(self):
        import time as _time
        model = rc.Model(rc.Config(), demo=True)
        self.addCleanup(model.executor.shutdown, wait=False)
        model.load()
        for _ in range(100):
            model.process_jobs()
            if all((e.session is not None or e.note) for e in model.entries.values()):
                break
            _time.sleep(0.02)
        return model

    def test_view_is_exactly_terminal_height(self):
        model = self.make_model()
        for height in range(1, 46):
            model.width, model.height = 100, height
            with self.subTest(height=height):
                self.assertEqual(len(model.view()), height)

    def test_one_footer_while_replying(self):
        model = self.make_model()
        model.width, model.height = 100, 24
        entry = next(iter(model.entries.values()))
        model.order = [entry.agent.pane_id]
        model.start_reply()
        model.reply_text = "line one\nline two\nline three"
        lines = model.view()
        self.assertEqual(len(lines), 24)
        footers = [line for line in lines if "enter send" in line]
        self.assertEqual(len(footers), 1)
        self.assertIn("enter send", lines[-1])


class TruncateStyledTest(unittest.TestCase):
    def test_plain_and_styled(self):
        self.assertEqual(rc.truncate_styled("hello", 10), "hello")
        cut = rc.truncate_styled("hello world", 5)
        self.assertEqual(rc.display_width(cut), 5)
        styled = "\x1b[1m\x1b[38;2;1;2;3mhello world\x1b[0m"
        cut = rc.truncate_styled(styled, 5)
        self.assertEqual(rc.display_width(cut), 5)
        self.assertTrue(cut.endswith(rc.RESET))

    def test_draw_never_fills_last_column(self):
        import io
        from unittest import mock
        term = rc.RawTerminal.__new__(rc.RawTerminal)
        term.fd, term.saved, term._last_size = 1, None, None
        out = io.StringIO()
        with mock.patch.object(rc.sys, "stdout", out):
            term.draw(["x" * 200, "y" * 200], 72, 2)
        import re as _re
        rows = _re.split(r"\x1b\[\d+;1H", out.getvalue())
        for row in rows:
            plain = _re.sub(r"\x1b\[[0-9;:]*[A-Za-z]", "", row)
            self.assertLessEqual(rc.display_width(plain), 71)


class LayoutRegressionTest(ViewHeightTest):
    def test_long_replies_keep_footer_at_bottom(self):
        model = self.make_model()
        entry = next(iter(model.entries.values()))
        model.order = [entry.agent.pane_id]
        model.start_reply()
        for height in range(2, 31):
            for count in (1, 3, 6, 7, 12):
                model.width, model.height = 80, height
                model.reply_text = "\n".join(f"line {i}" for i in range(count))
                with self.subTest(height=height, count=count):
                    lines = model.view()
                    self.assertEqual(len(lines), height)
                    self.assertIn("enter send", lines[-1])

    def test_multiline_prompt_stays_in_one_status_row(self):
        model = self.make_model()
        model.width, model.height = 80, 24
        entry = next(e for e in model.entries.values() if e.session)
        model.order = [entry.agent.pane_id]
        model.cursor = 0
        entry.session.meta.last_prompt = "first\nsecond\tthird\r"
        status = model.status_line()
        self.assertIn("first second third", status)
        self.assertNotIn("\n", status)
        self.assertNotIn("\t", status)
        self.assertNotIn("\r", status)

    def test_resize_forces_redraw_without_spinner_tick(self):
        from unittest import mock
        model = self.make_model()
        model.width, model.height = 80, 24
        model.last_poll = model.last_spin = 10.0
        model.dirty = True
        term = mock.Mock()
        term.size.side_effect = [(80, 24), (60, 8)]
        with mock.patch.object(model, "load"), mock.patch.object(model, "process_jobs"), \
                mock.patch.object(rc.time, "monotonic", return_value=10.0), \
                mock.patch.object(rc.select, "select", side_effect=[([], [], []), ([0], [], [])]), \
                mock.patch.object(rc.os, "read", return_value=b""):
            model.run(term)
        self.assertEqual(term.draw.call_count, 2)
        self.assertEqual(term.draw.call_args.args[1:], (60, 8))
        self.assertEqual(len(term.draw.call_args.args[0]), 8)


class TerminalRegressionTest(unittest.TestCase):
    def test_size_uses_pty_instead_of_environment(self):
        from unittest import mock
        term = rc.RawTerminal.__new__(rc.RawTerminal)
        term.fd = 42
        with mock.patch.dict(rc.os.environ, {"COLUMNS": "200", "LINES": "60"}), \
                mock.patch.object(rc.os, "get_terminal_size", return_value=os.terminal_size((72, 18))) as size:
            self.assertEqual(term.size(), (72, 18))
            size.assert_called_once_with(42)

    def test_rows_cannot_scroll_or_move_cursor(self):
        import io
        from unittest import mock
        term = rc.RawTerminal.__new__(rc.RawTerminal)
        term._last_size = None
        out = io.StringIO()
        with mock.patch.object(rc.sys, "stdout", out):
            term.draw(["tabs", "\x1b[31mfirst\nsecond\tthird\x1b[10B\x1b[0m", "footer"], 80, 3)
        frame = out.getvalue()
        self.assertNotIn("\n", frame)
        self.assertNotIn("\t", frame)
        self.assertNotIn("\x1b[10B", frame)
        self.assertIn("\x1b[31mfirst second third", frame)
        for row in (1, 2, 3):
            self.assertIn(f"\x1b[{row};1H\x1b[0m\x1b[2K", frame)


class ReplyRegressionTest(unittest.TestCase):
    def test_prompt_waits_for_submission(self):
        from unittest import mock
        with mock.patch.object(rc, "herdr_call") as call:
            rc.send_agent_reply("w1:p1", "hello\nthere")
        self.assertEqual(call.call_count, 1)
        self.assertEqual(call.call_args.args[0], "agent.prompt")
        self.assertEqual(call.call_args.args[1]["text"], "hello\nthere")
        self.assertIn("working", call.call_args.args[1]["wait"]["until"])
        self.assertGreater(call.call_args.kwargs["timeout"], 7)

    def test_stalled_prompt_retries_only_enter(self):
        from unittest import mock
        with mock.patch.object(rc, "herdr_call", side_effect=[rc.HerdrError("agent_prompt_stalled"), {}, {}]) as call:
            rc.send_agent_reply("w1:p1", "hello")
        self.assertEqual([c.args[0] for c in call.call_args_list], ["agent.prompt", "agent.send_keys", "agent.wait"])
        self.assertEqual(call.call_args_list[1].args[1], {"target": "w1:p1", "keys": ["enter"]})
        self.assertIn("working", call.call_args_list[2].args[1]["until"])

    def test_other_errors_never_retry_enter(self):
        from unittest import mock
        for code in ("agent_blocked", "timeout", "agent_not_ready", "transport"):
            with self.subTest(code=code), \
                    mock.patch.object(rc, "herdr_call", side_effect=rc.HerdrError(code)) as call:
                with self.assertRaises(rc.HerdrError):
                    rc.send_agent_reply("w1:p1", "hello")
                self.assertEqual(call.call_count, 1)

    def test_tab_message_enter_keeps_draft_until_success(self):
        from unittest import mock
        model = rc.Model(rc.Config())
        self.addCleanup(model.executor.shutdown, wait=False)
        entry = rc.Entry(agent=rc.AgentInfo(pane_id="w1:p1", agent="pi", title="Test"))
        model.entries = {"w1:p1": entry}
        model.order = ["w1:p1"]
        model.handle_key("tab")
        model.handle_reply_key("", "hello")
        with mock.patch.object(model, "submit") as submit, \
                mock.patch.object(rc, "send_agent_reply") as send:
            model.handle_key("enter")
            model.handle_key("enter")
            self.assertTrue(model.replying)
            self.assertTrue(model.reply_sending)
            self.assertEqual(model.reply_text, "hello")
            submit.assert_called_once()
            submit.call_args.args[2]()
            send.assert_called_once_with("w1:p1", "hello")
        model.handle_action_result("reply", entry, {}, None)
        self.assertFalse(model.replying)
        self.assertFalse(model.reply_sending)
        self.assertEqual(model.reply_text, "")
        self.assertEqual(model.flash, "Sent.")

    def test_failed_reply_preserves_draft_and_shows_error(self):
        from unittest import mock
        model = rc.Model(rc.Config())
        self.addCleanup(model.executor.shutdown, wait=False)
        entry = rc.Entry(agent=rc.AgentInfo(pane_id="w1:p1", agent="pi", title="Test"))
        model.entries = {"w1:p1": entry}
        model.order = ["w1:p1"]
        model.width, model.height = 80, 24
        model.start_reply()
        model.reply_text = "keep this draft"
        with mock.patch.object(model, "submit"):
            model.send_reply()
        model.handle_action_result("reply", entry, None, rc.HerdrError("timeout"))
        self.assertTrue(model.replying)
        self.assertFalse(model.reply_sending)
        self.assertEqual(model.reply_text, "keep this draft")
        self.assertIn("Couldn't send", model.status_line())


class PopupStateAndScrollTest(unittest.TestCase):
    def make_model(self, count=4):
        model = rc.Model(rc.Config())
        self.addCleanup(model.executor.shutdown, wait=False)
        model.width, model.height, model.loaded = 80, 12, True
        model.show = "idle"
        model.entries = {
            f"w1:p{i}": rc.Entry(agent=rc.AgentInfo(
                pane_id=f"w1:p{i}", agent="claude", status="idle", title=f"Item {i}"))
            for i in range(count)
        }
        model.resort("")
        return model

    def test_snooze_return_restores_tab_and_number_not_pane(self):
        from unittest import mock
        model = self.make_model()
        model.move(1)
        model.scroll_rows(3)
        model.links[rc.SNOOZE_PLUGIN] = {"plugin_id": rc.SNOOZE_PLUGIN, "entrypoint": "picker"}
        old_pane = model.selected_pane()
        with mock.patch.object(rc, "spawn_handoff") as handoff:
            self.assertEqual(model.handle_key("ctrl+s"), "quit")
        outgoing = handoff.call_args.args[0]
        back = json.loads(outgoing["env"][rc.RETURN_ENV])
        self.assertEqual(json.loads(back["env"][rc.UI_STATE_ENV]), model.ui_state())
        self.assertNotIn(rc.SELECT_ENV, back["env"])
        restored = self.make_model()
        restored.entries[old_pane].agent.tokens[rc.SNOOZE_MARK] = "1"
        with mock.patch.dict(rc.os.environ, back["env"]):
            restored.restore_ui_state()
        restored.resort("")
        self.assertEqual(restored.show, "idle")
        self.assertEqual(restored.cursor, 1)
        self.assertEqual(restored.selected_pane(), "w1:p2")
        self.assertNotEqual(restored.selected_pane(), old_pane)
        self.assertEqual(restored.offset, 0)

    def test_restore_ignores_legacy_filter_and_offset(self):
        from unittest import mock
        model = self.make_model()
        model.filter, model.filter_cursor, model.offset = "old query", 9, 99
        state = {"tab": "idle", "cursor": 2, "filter": "legacy query", "offset": 999}
        with mock.patch.dict(rc.os.environ, {rc.UI_STATE_ENV: json.dumps(state)}):
            model.restore_ui_state()
        self.assertEqual((model.filter, model.filter_cursor, model.offset), ("", 0, 0))
        model.resort("")
        self.assertEqual(model.cursor, 2)
        self.assertEqual(model.order, ["w1:p0", "w1:p1", "w1:p2", "w1:p3"])
        self.assertEqual(model.ui_state(), {"tab": "idle", "cursor": 2})

    def test_saved_state_contains_only_tab_and_position(self):
        from pathlib import Path
        from unittest import mock
        model = self.make_model()
        model.cursor, model.offset, model.filter = 2, 4, "temporary query"
        with tempfile.TemporaryDirectory() as directory, \
                mock.patch.object(rc, "ui_state_path", return_value=Path(directory) / "ui.json"):
            model.save_ui_state()
            self.assertEqual(json.loads(rc.ui_state_path().read_text()), {"tab": "idle", "cursor": 2})

    def test_restore_clamps_number_for_shorter_or_empty_list(self):
        from unittest import mock
        for count, expected in ((2, 1), (0, 0)):
            with self.subTest(count=count):
                model = self.make_model(count)
                env = {rc.UI_STATE_ENV: json.dumps({"tab": "idle", "cursor": 3, "offset": 100})}
                with mock.patch.dict(rc.os.environ, env):
                    model.restore_ui_state()
                model.resort("")
                self.assertEqual(model.show, "idle")
                self.assertEqual(model.cursor, expected)
                self.assertEqual(model.offset, 0)
                self.assertEqual(len(model.view()), 12)

    def test_saved_state_restores_on_normal_reopen(self):
        from pathlib import Path
        from unittest import mock
        model = self.make_model()
        model.move(2)
        model.scroll_rows(3)
        with tempfile.TemporaryDirectory() as directory, \
                mock.patch.object(rc, "ui_state_path", return_value=Path(directory) / "ui.json"), \
                mock.patch.dict(rc.os.environ):
            rc.os.environ.pop(rc.UI_STATE_ENV, None)
            model.save_ui_state()
            self.assertEqual(json.loads(rc.ui_state_path().read_text()), model.ui_state())
            restored = self.make_model()
            restored.start_on = ""
            restored.restore_ui_state()
            restored.resort("")
            self.assertEqual(restored.ui_state(), model.ui_state())
            self.assertEqual(rc.ui_state_path().stat().st_mode & 0o777, 0o600)

    def test_enter_exit_saves_tab_and_numerical_selection(self):
        from pathlib import Path
        from unittest import mock
        def run(model, term):
            fixture = self.make_model()
            model.show, model.loaded = "idle", True
            model.entries, model.order = fixture.entries, fixture.order
            model.cursor, model.picked = 2, True
            model.handle_key("enter")
            for job in model.jobs:
                job.future.result(timeout=2)
            model.process_jobs()
        with tempfile.TemporaryDirectory() as directory, \
                mock.patch.object(rc, "ui_state_path", return_value=Path(directory) / "ui.json"), \
                mock.patch.object(rc.Model, "run", run), \
                mock.patch.object(rc, "RawTerminal"), \
                mock.patch.object(rc, "note_popup", return_value=lambda: None), \
                mock.patch.object(rc, "focus_agent") as focus, \
                mock.patch.object(rc.os, "_exit", side_effect=SystemExit(0)), \
                mock.patch.dict(rc.os.environ):
            rc.os.environ.pop(rc.UI_STATE_ENV, None)
            rc.os.environ.pop(rc.SELECT_ENV, None)
            with self.assertRaises(SystemExit):
                rc.run_picker(rc.Config(), demo=False)
            focus.assert_called_once_with("w1:p2")
            state = json.loads(rc.ui_state_path().read_text())
            self.assertEqual(state["tab"], "idle")
            self.assertEqual(state["cursor"], 2)

    def test_handoff_state_wins_over_disk_and_explicit_pane(self):
        from unittest import mock
        model = self.make_model()
        model.start_on = "w1:p0"
        with mock.patch.dict(rc.os.environ, {rc.UI_STATE_ENV: json.dumps({"tab": "idle", "cursor": 2})}), \
                mock.patch.object(rc, "ui_state_path") as disk:
            model.restore_ui_state()
        disk.assert_not_called()
        model.resort("")
        self.assertEqual(model.start_on, "")
        self.assertEqual(model.cursor, 2)

    def test_bad_state_is_ignored(self):
        from unittest import mock
        for raw in ("broken", "[]", '{"tab": [], "cursor": false, "offset": "bad"}'):
            with self.subTest(raw=raw):
                model = self.make_model()
                with mock.patch.dict(rc.os.environ, {rc.UI_STATE_ENV: raw}):
                    model.restore_ui_state()
                model.resort("")
                self.assertEqual(model.show, "idle")
                self.assertEqual(model.cursor, 0)
                self.assertEqual(model.offset, 0)

    def test_state_is_scoped_to_herdr_session(self):
        from unittest import mock
        with mock.patch.dict(rc.os.environ, {"HERDR_SOCKET_PATH": "/tmp/session-one.sock"}):
            first = rc.ui_state_path()
        with mock.patch.dict(rc.os.environ, {"HERDR_SOCKET_PATH": "/tmp/session-two.sock"}):
            second = rc.ui_state_path()
        self.assertNotEqual(first, second)

    def test_native_wheel_scrolls_rows_without_moving_selection(self):
        from unittest import mock
        model = self.make_model()
        before = model.view()
        content = [line for i, pane in enumerate(model.order)
                   for line in model.entry_lines(model.entries[pane], i == model.cursor, i)]
        events = rc.Decoder().feed(b"\x1b[<65;5;6M")
        self.assertEqual(events, [("mouse", "wheel_down", 4, 5, "M")])
        with mock.patch.object(model, "move") as move:
            model.handle_mouse(events[0])
        move.assert_not_called()
        after = model.view()
        self.assertEqual(model.cursor, 0)
        self.assertEqual(model.offset, 1)
        self.assertEqual(after[4:10], content[1:7])
        self.assertEqual(before[:4], after[:4])
        self.assertEqual(before[-2:], after[-2:])

    def test_wheel_bounds_and_non_content_rows(self):
        model = self.make_model()
        model.scroll_rows(-100)
        self.assertEqual(model.offset, 0)
        model.scroll_rows(100)
        self.assertEqual(model.offset, model.entry_layout()[-1][2] - model.list_height())
        old_offset = model.offset
        for y in (0, 2, model.height - 2, model.height - 1):
            model.handle_mouse(("mouse", "wheel_up", 4, y, "M"))
        self.assertEqual(model.offset, old_offset)
        model.handle_mouse(("mouse", "wheel_up", 4, 5, "M"))
        self.assertEqual(model.offset, old_offset - 1)

    def test_poll_preserves_scroll_and_keyboard_reveals_selection(self):
        model = self.make_model()
        model.scroll_rows(6)
        model.resort(model.selected_pane())
        self.assertEqual(model.offset, 6)
        self.assertEqual(model.cursor, 0)
        model.handle_key("home")
        self.assertFalse(model.free_scroll)
        self.assertEqual(model.offset, 0)

    def test_partial_entry_keeps_correct_mouse_hit_rows(self):
        from unittest import mock
        model = self.make_model()
        model.scroll_rows(1)
        model.view()
        self.assertEqual(model.row_ranges[0], (4, 0, 1))
        with mock.patch.object(model, "activate") as activate:
            model.handle_mouse(("mouse", "press", 70, 7, "M"))
        self.assertEqual(model.cursor, 1)
        activate.assert_called_once()

    def test_wheel_during_reply_preserves_reply_target_and_text(self):
        model = self.make_model()
        model.start_reply()
        model.reply_text = "keep this message"
        target = model.reply_to
        model.handle_mouse(("mouse", "wheel_down", 4, 5, "M"))
        self.assertEqual(model.offset, 1)
        self.assertEqual(model.reply_to, target)
        self.assertEqual(model.reply_text, "keep this message")
        self.assertEqual(model.cursor, 0)

    def test_group_headings_and_partial_rows_match_full_content(self):
        model = self.make_model()
        model.show = "all"
        model.entries["w1:p2"].agent.status = "blocked"
        model.resort("")
        content = []
        for i, pane in enumerate(model.order):
            if model.headed(i):
                content.extend((model.heading_line(rc.stage_of(model.entries[pane])), ""))
            content.extend(model.entry_lines(model.entries[pane], i == model.cursor, i))
        for offset in range(len(content) - model.list_height() + 1):
            with self.subTest(offset=offset):
                model.offset = offset
                lines = model.view()
                self.assertEqual(lines[4:10], content[offset:offset + 6])
                self.assertEqual(len(lines), model.height)


class PickerExitTest(unittest.TestCase):
    def test_picker_exits_with_blocked_workers(self):
        # Regression: Esc restored the terminal but the process stayed
        # alive until Ctrl+C, because interpreter shutdown joins every
        # executor worker — including ones blocked in a summarizer call.
        import subprocess
        import textwrap
        script = textwrap.dedent("""
            import importlib.util, sys, threading
            spec = importlib.util.spec_from_file_location("rc", sys.argv[1])
            rc = importlib.util.module_from_spec(spec)
            sys.modules["rc"] = rc
            spec.loader.exec_module(rc)

            class FakeTerm:
                def __enter__(self): return self
                def __exit__(self, *exc): return False

            rc.RawTerminal = FakeTerm

            def fake_run(self, term):
                self.executor.submit(lambda: threading.Event().wait(30))
                return None

            rc.Model.run = fake_run
            sys.exit(rc.run_picker(rc.Config(), demo=True))
        """)
        path = os.path.join(_HERE, "..", "herdr-recap.py")
        proc = subprocess.run(
            [sys.executable, "-c", script, os.path.abspath(path)],
            capture_output=True, text=True, timeout=10)
        self.assertEqual(proc.returncode, 0, proc.stderr)
