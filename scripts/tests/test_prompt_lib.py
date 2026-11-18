"""Selection, modified keys, mouse hit-testing and cleanup for prompt-lib.py."""
import importlib.util
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[2] / "stow_modules/main/dot-config/herdr/scripts"
spec = importlib.util.spec_from_file_location("prompt_lib_selection_tests", SCRIPTS / "prompt-lib.py")
lib = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = lib
spec.loader.exec_module(lib)

SHIFT, ALT, CTRL, SUPER, META = 1, 2, 4, 8, 32


def csi(code, bits=0, final="u"):
    return f"\x1b[{code};{bits + 1}{final}".encode()


def arrow(letter, bits=0):
    return f"\x1b[1;{bits + 1}{letter}".encode()


class PromptCase(unittest.TestCase):
    cols = 80
    lines = 24

    def setUp(self):
        for p in (patch.dict(os.environ, {"PROMPT_LIB_HISTORY": "0"}),
                  patch.object(lib.shutil, "get_terminal_size",
                               side_effect=lambda *_a: os.terminal_size((self.cols, self.lines)))):
            p.start()
            self.addCleanup(p.stop)

    def make(self, text="", pos=None, label="P: ", complete=None, **kw):
        term = lib._DoctestTerminal(b"")
        p = lib.Prompt(term, label, text, "t", complete=complete, **kw)
        if pos is not None:
            p.pos = pos
        return p

    def feed(self, p, data):
        p.term.pending = bytearray(data)
        while p.term.pending:
            if p.handle_byte(p.term.read_byte()):
                break
        return p

    def select(self, p, anchor, pos):
        p.selection_anchor, p.pos = anchor, pos
        return p

    def click(self, p, x, y, button=0, released=False):
        p.handle_mouse(button, x, y, released)


class KeyTests(PromptCase):
    def test_csi_shift_arrows_select(self):
        p = self.feed(self.make("hello", 2), arrow("D", SHIFT) + arrow("D", SHIFT))
        self.assertEqual((p.pos, p.selection()), (0, (0, 2)))
        p = self.feed(self.make("hello", 2), arrow("C", SHIFT))
        self.assertEqual(p.selection(), (2, 3))

    def test_shift_home_end(self):
        p = self.feed(self.make("ab cd", 2), arrow("H", SHIFT))
        self.assertEqual(p.selection(), (0, 2))
        p = self.feed(self.make("ab cd", 2), arrow("F", SHIFT))
        self.assertEqual(p.selection(), (2, 5))

    def test_alt_and_cmd_arrows(self):
        self.assertEqual(self.feed(self.make("foo bar baz"), arrow("D", ALT)).pos, 8)
        self.assertEqual(self.feed(self.make("foo bar baz", 0), arrow("C", ALT)).pos, 3)
        self.assertEqual(self.feed(self.make("ab\ncd ef", 6), arrow("D", SUPER)).pos, 3)
        self.assertEqual(self.feed(self.make("ab\ncd ef", 3), arrow("C", SUPER)).pos, 8)
        self.assertEqual(self.feed(self.make("ab\ncd ef", 3), arrow("D", META)).pos, 3)

    def test_shift_alt_and_shift_cmd_select(self):
        p = self.feed(self.make("foo bar"), arrow("D", SHIFT | ALT))
        self.assertEqual(p.selection(), (4, 7))
        p = self.feed(self.make("ab\ncd ef"), arrow("D", SHIFT | SUPER))
        self.assertEqual(p.selection(), (3, 8))

    def test_cmd_up_down_go_to_buffer_edges(self):
        self.assertEqual(self.feed(self.make("a\nb\nc", 2), arrow("A", SUPER)).pos, 0)
        self.assertEqual(self.feed(self.make("a\nb\nc", 2), arrow("B", SUPER)).pos, 5)
        p = self.feed(self.make("a\nb\nc", 2), arrow("A", SUPER | SHIFT))
        self.assertEqual(p.selection(), (0, 2))

    def test_ctrl_and_alt_home_end_buffer_edges(self):
        self.assertEqual(self.feed(self.make("a\nb", 2), arrow("H", ALT)).pos, 0)
        self.assertEqual(self.feed(self.make("a\nb", 0), arrow("F", CTRL)).pos, 3)

    def test_kitty_navigation_codes(self):
        for code, bits, start, expected in [
            (57350, 0, 3, 2), (57351, 0, 3, 4), (57356, 0, 3, 0), (57357, 0, 3, 5),
            (57350, ALT, 5, 4), (57351, ALT, 0, 3), (57350, SUPER, 3, 0),
        ]:
            with self.subTest(code=code, bits=bits):
                p = self.make("foo b", start)
                self.feed(p, csi(code, bits))
                self.assertEqual(p.pos, expected)
        p = self.feed(self.make("abc", 1), csi(57351, SHIFT))
        self.assertEqual(p.selection(), (1, 2))

    def test_kitty_vertical_codes(self):
        p = self.feed(self.make("abc\ndef", 1), csi(57353))
        self.assertEqual(p.pos, 5)
        p = self.feed(p, csi(57352, SHIFT))
        self.assertEqual(p.selection(), (1, 5))

    def test_backspace_and_delete_variants(self):
        for data in (b"\x7f", csi(127, 0).replace(b";1u", b"u"), b"\x1b[127;1u"):
            with self.subTest(data=data):
                self.assertEqual(self.feed(self.make("abc"), data).buf, "ab")
        for data in (b"\x1b[57349u", b"\x1b[3~", b"\x1b[57349;1u"):
            with self.subTest(data=data):
                self.assertEqual(self.feed(self.make("abc", 1), data).buf, "ac")

    def test_modified_backspace_and_delete(self):
        self.assertEqual(self.feed(self.make("foo bar"), csi(127, ALT)).buf, "foo ")
        self.assertEqual(self.feed(self.make("ab\ncd ef"), csi(127, SUPER)).buf, "ab\n")
        self.assertEqual(self.feed(self.make("foo bar", 0), csi(57349, ALT)).buf, " bar")
        self.assertEqual(self.feed(self.make("ab cd\nx", 3), csi(57349, SUPER)).buf, "ab \nx")
        self.assertEqual(self.feed(self.make("ab cd", 3), b"\x1b[3;9~").buf, "ab ")
        self.assertEqual(self.feed(self.make("foo bar", 0), b"\x1b[3;3~").buf, " bar")
        p = self.make("foo bar")
        p.modified_delete(False, ALT)
        self.assertEqual(p.kill, "bar")

    def test_replace_selection_by_typing_including_pos_zero(self):
        p = self.feed(self.select(self.make("hello world"), 0, 5), b"X")
        self.assertEqual((p.buf, p.pos, p.selection()), ("X world", 1, None))
        p = self.feed(self.select(self.make("hello"), 5, 0), b"X")  # reversed
        self.assertEqual(p.buf, "X")
        p = self.feed(self.select(self.make("hello"), 3, 0), "é".encode())
        self.assertEqual((p.buf, p.pos), ("élo", 1))

    def test_replace_selection_by_paste(self):
        p = self.feed(self.select(self.make("hello world"), 6, 11), b"\x1b[200~there\x1b[201~")
        self.assertEqual(p.buf, "hello there")

    def test_delete_selection_including_pos_zero(self):
        for data in (b"\x7f", b"\x1b[3~", b"\x1b[127;3u", b"\x1b[57349;9u"):
            with self.subTest(data=data):
                p = self.feed(self.select(self.make("hello"), 3, 0), data)
                self.assertEqual((p.buf, p.pos, p.selection()), ("lo", 0, None))
        p = self.feed(self.select(self.make("hello"), 0, 3), b"\x7f")
        self.assertEqual((p.buf, p.pos), ("lo", 0))
        p = self.feed(self.select(self.make("hello"), 0, 5), b"\x04")  # Ctrl-D
        self.assertEqual(p.buf, "")

    def test_selection_ignores_empty_range(self):
        p = self.make("abc", 1)
        self.assertIsNone(p.selection())
        p.move_to(2, extend=True)
        p.move_to(1, extend=True)
        self.assertIsNone(p.selection())

    def test_plain_arrows_collapse_selection(self):
        p = self.feed(self.select(self.make("abcdef"), 4, 1), arrow("D"))
        self.assertEqual((p.pos, p.selection()), (1, None))
        p = self.feed(self.select(self.make("abcdef"), 1, 4), arrow("D"))
        self.assertEqual(p.pos, 1)
        p = self.feed(self.select(self.make("abcdef"), 1, 4), arrow("C"))
        self.assertEqual(p.pos, 4)
        p = self.feed(self.select(self.make("abcdef"), 4, 1), arrow("C"))
        self.assertEqual(p.pos, 4)
        p = self.feed(self.select(self.make("abcdef"), 1, 4), b"\x02")  # Ctrl-B
        self.assertEqual((p.pos, p.selection()), (1, None))

    def test_escape_clears_selection_before_cancelling(self):
        p = self.feed(self.select(self.make("abc"), 0, 2), b"\x1b")
        self.assertEqual((p.selection(), p.cancelled, p.buf), (None, False, "abc"))

    def test_select_all_cmd_a(self):
        p = self.feed(self.make("abc", 1), csi(97, SUPER))
        self.assertEqual(p.selection(), (0, 3))

    def test_replacement_undo_is_single_step(self):
        p = self.feed(self.select(self.make("hello world"), 0, 5), b"X")
        self.feed(p, b"\x1f")
        self.assertEqual(p.buf, "hello world")
        self.assertIsNone(p.selection())
        self.assertEqual(p.undo, [])

    def test_delete_selection_undo_is_single_step(self):
        p = self.feed(self.select(self.make("hello world"), 6, 0), b"\x7f")
        self.assertEqual(p.buf, "world")
        self.feed(p, b"\x1f")
        self.assertEqual(p.buf, "hello world")

    def test_move_to_clamps_and_vertical_keeps_goal(self):
        p = self.make("abc", 1)
        p.goal_col = 3
        p.move_to(99, vertical=True)
        self.assertEqual((p.pos, p.goal_col), (3, 3))
        p.move_to(-5)
        self.assertEqual((p.pos, p.goal_col), (0, None))

    def test_ctrl_a_e_and_double_press(self):
        p = self.feed(self.make("ab\ncd", 4), b"\x01")
        self.assertEqual(p.pos, 3)
        self.feed(p, b"\x01")
        self.assertEqual(p.pos, 0)

    def test_home_end_repeat_preserves_buffer_edge_shortcut(self):
        for home in (b"\x1b[H", b"\x1b[1~", csi(57356)):
            p = self.feed(self.make("a\nb\nc", 5), home + home)
            self.assertEqual(p.pos, 0)
        for end in (b"\x1b[F", b"\x1b[4~", csi(57357)):
            p = self.feed(self.make("a\nb\nc", 0), end + end)
            self.assertEqual(p.pos, 5)

    def test_bare_escape_uses_short_ambiguity_timeout(self):
        p = self.make()
        with patch.object(p.term, "read_byte", return_value=None) as read:
            p.handle_escape()
        read.assert_called_once_with(timeout=0.01)
        self.assertTrue(p.cancelled)

    def test_double_escape_uses_short_ambiguity_timeout(self):
        p = self.make()
        with patch.object(p.term, "read_byte", side_effect=[lib.ESC, None]) as read:
            p.handle_escape()
        self.assertEqual([c.kwargs["timeout"] for c in read.call_args_list], [0.01, 0.01])
        self.assertTrue(p.cancelled)

    def test_legacy_alt_shift_arrows_select(self):
        p = self.feed(self.make("foo bar"), b"\x1b\x1b[1;2D")
        self.assertEqual(p.selection(), (4, 7))

    def test_case_transpose_and_buffer_jump_clear_click_anchor(self):
        for data in (b"\x1b<", b"\x1b>", b"\x1bu", b"\x14", b"\x1bt"):
            p = self.make("foo bar baz", 4)
            p.selection_anchor = p.pos
            self.feed(p, data)
            self.assertIsNone(p.selection(), data)
        p = self.select(self.make("ß world"), 0, 1)
        self.feed(p, b"\x1bu")
        self.assertEqual((p.buf, p.pos, p.selection()), ("SS world", 2, None))

    def test_unmodified_modifier_event_release_ignored(self):
        p = self.feed(self.make("abc"), b"\x1b[57351;1:3u")
        self.assertEqual(p.pos, 3)


class VerticalTests(PromptCase):
    cols = 10  # label 3 -> 6 cells on first row, 5 on wrapped rows

    def test_split_reserves_last_column(self):
        p = self.make("abcdefghijklmnop")
        rows = p.split_visual_lines(10)
        self.assertEqual([r.text for r in rows], ["abcdef", "ghijk", "lmnop"])
        self.assertEqual([r.final_for_logical for r in rows], [False, False, True])
        self.assertTrue(all(lib.display_width(r.prefix + r.text) <= 9 for r in rows))
        self.assertEqual([r.text for r in self.make("abcdefgh").split_visual_lines(9)], ["abcde", "fgh"])

    def test_soft_wrapped_up_down(self):
        p = self.make("abcdefghijklmnop", 2)
        p.move_vertical(1)
        self.assertEqual(p.pos, 8)
        p.move_vertical(1)
        self.assertEqual(p.pos, 13)
        p.move_vertical(1)  # last row stays put
        self.assertEqual(p.pos, 13)
        p.move_vertical(-1)
        self.assertEqual(p.pos, 8)
        p.move_vertical(-1)
        self.assertEqual(p.pos, 2)
        p.move_vertical(-1)
        self.assertEqual(p.pos, 2)

    def test_soft_wrap_boundary_belongs_to_next_row(self):
        p = self.make("abcdefghijklmnop", 6)
        rows = p.split_visual_lines(10)
        self.assertEqual(p.cursor_in_rows(rows)[0], 1)
        p.move_vertical(-1)
        self.assertLess(p.pos, 6)

    def test_down_never_lands_on_soft_row_end(self):
        p = self.make("abcdefghijklmnop", 5)  # col 5 on first row
        p.move_vertical(1)
        self.assertEqual(p.pos, 10)  # last char slot of row 1, not 11 (row 2)
        self.assertEqual(p.cursor_in_rows(p.split_visual_lines(10))[0], 1)

    def test_sticky_column_across_short_lines(self):
        self.cols = 80
        p = self.make("abcdef\nab\nabcdef", 5)
        p.move_vertical(1)
        self.assertEqual(p.pos, 9)
        p.move_vertical(1)
        self.assertEqual(p.pos, 15)
        p.move_vertical(-1)
        p.move_vertical(-1)
        self.assertEqual(p.pos, 5)

    def test_sticky_column_through_keys_and_reset_by_horizontal(self):
        self.cols = 80
        p = self.feed(self.make("abcdef\nab\nabcdef", 5), arrow("B") + arrow("B"))
        self.assertEqual(p.pos, 15)
        self.feed(p, arrow("D") + arrow("A") + arrow("A"))
        self.assertEqual(p.goal_col, 4)
        self.assertEqual(p.pos, 4)

    def test_shift_down_and_up_extend(self):
        self.cols = 80
        p = self.feed(self.make("abcdef\nabcdef", 2), arrow("B", SHIFT))
        self.assertEqual(p.selection(), (2, 9))
        self.feed(p, arrow("A", SHIFT))
        self.assertIsNone(p.selection())

    def test_vertical_move_with_wide_glyphs(self):
        self.cols = 80
        p = self.make("你好吗\nabcdef", 2)  # cursor col 4
        p.move_vertical(1)
        self.assertEqual(p.pos, 8)

    def test_shift_vertical_at_edges_selects_buffer_boundary(self):
        p = self.make("abcdefghijklmnop", 2)
        p.navigate("up", SHIFT)
        self.assertEqual(p.selection(), (0, 2))
        p = self.make("abcdefghijklmnop", 13)
        p.navigate("down", SHIFT)
        self.assertEqual(p.selection(), (13, 16))

    def test_up_down_with_empty_buffer_history_disabled(self):
        self.cols = 80
        p = self.feed(self.make(""), arrow("A") + arrow("B"))
        self.assertEqual((p.buf, p.pos), ("", 0))


class MouseTests(PromptCase):
    def prompt(self, text="hello world", pos=0, **kw):
        p = self.make(text, pos, **kw)
        p.render()
        p.screen_origin = 1
        return p

    def test_ignored_without_origin(self):
        p = self.make("hello")
        p.render()
        self.click(p, 5, 1)
        self.assertEqual((p.pos, p.mouse_down), (5, False))

    def test_click_places_caret_and_labels_clamp(self):
        p = self.prompt()
        self.click(p, 6, 1)  # prefix 3 -> col 2
        self.assertEqual((p.pos, p.selection(), p.mouse_down), (2, None, True))
        self.click(p, 6, 1, released=True)
        self.assertFalse(p.mouse_down)
        self.click(p, 1, 1)  # on label
        self.assertEqual(p.pos, 0)
        self.click(p, 80, 1)
        self.assertEqual(p.pos, 11)

    def test_drag_and_release_selects(self):
        p = self.prompt()
        self.click(p, 4, 1)
        self.click(p, 9, 1, button=32)
        self.assertEqual(p.selection(), (0, 5))
        self.click(p, 12, 1, released=True)
        self.assertEqual(p.selection(), (0, 8))
        self.assertFalse(p.mouse_down)

    def test_release_without_press_is_ignored(self):
        p = self.prompt(pos=3)
        self.click(p, 9, 1, released=True)
        self.assertEqual((p.pos, p.mouse_down, p.selection_anchor), (3, False, None))

    def test_plain_click_release_clears_empty_anchor(self):
        p = self.prompt()
        self.click(p, 6, 1)
        self.click(p, 6, 1, released=True)
        self.assertIsNone(p.selection_anchor)

    def test_motion_without_press_ignored(self):
        p = self.prompt(pos=3)
        self.click(p, 9, 1, button=32)
        self.assertEqual((p.pos, p.mouse_down), (3, False))

    def test_shift_click_extends_selection(self):
        p = self.prompt(pos=2)
        self.click(p, 10, 1, button=4)
        self.assertEqual(p.selection(), (2, 6))

    def test_ignore_wheel_and_other_buttons(self):
        p = self.prompt(pos=3)
        for button in (64, 65, 1, 2, 66):
            self.click(p, 5, 1, button=button)
        self.assertEqual((p.pos, p.mouse_down, p.selection()), (3, False, None))

    def test_csi_mouse_sequences_dispatch(self):
        p = self.prompt()
        self.feed(p, b"\x1b[<0;6;1M\x1b[<32;9;1M\x1b[<0;9;1m")
        self.assertEqual(p.selection(), (2, 5))
        self.assertFalse(p.mouse_down)

    def test_click_outside_visible_prompt_rows_ignored(self):
        p = self.prompt(pos=3)
        self.click(p, 5, 0)
        self.click(p, 5, 2)
        self.assertEqual((p.pos, p.mouse_down), (3, False))
        self.click(p, 5, 1)  # origin offset
        p.mouse_down = False
        p.screen_origin = 5
        self.click(p, 5, 1)
        self.assertFalse(p.mouse_down)

    def test_wrapped_rows_and_continuation_prefix(self):
        self.cols = 10
        p = self.prompt("abcdefghijklmnop")
        self.assertEqual(p.visible_prompt_rows, 3)
        self.click(p, 7, 2)  # continuation prefix is 4 wide -> col 2
        self.assertEqual(p.pos, 8)
        self.click(p, 1, 2)
        self.assertEqual(p.pos, 6)
        self.click(p, 10, 1)  # soft row cannot take the next row's first slot
        self.assertEqual(p.pos, 5)
        self.click(p, 10, 3)
        self.assertEqual(p.pos, 16)
        self.click(p, 5, 3)
        self.assertEqual(p.pos, 11)

    def test_wide_glyph_hit_testing(self):
        p = self.prompt("你好a")
        for x, expected in [(4, 0), (5, 0), (6, 1), (7, 1), (8, 2), (9, 3), (40, 3)]:
            with self.subTest(x=x):
                p.last_click = None
                self.click(p, x, 1)
                self.assertEqual(p.pos, expected)
                p.mouse_down = False

    def test_multiline_labels(self):
        p = self.prompt("ab\ncd")
        self.click(p, 5, 2)  # second logical line has blank label spaces
        self.assertEqual(p.pos, 4)
        self.click(p, 1, 2)
        self.assertEqual(p.pos, 3)

    def test_scroll_viewport_uses_top_line(self):
        self.lines = 3
        text = "\n".join(f"l{i}" for i in range(6))
        p = self.prompt(text, len(text))
        self.assertEqual((p.top_line, p.visible_prompt_rows), (3, 3))
        self.click(p, 5, 1)  # visible row 0 is logical line 3 ("l3")
        self.assertEqual(p.pos, text.index("l3") + 1)
        p.mouse_down = False
        self.click(p, 4, 3)
        self.assertEqual(p.pos, text.index("l5"))

    def test_drag_beyond_viewport_scrolls(self):
        self.lines = 3
        text = "\n".join(f"l{i}" for i in range(6))
        p = self.prompt(text, len(text))
        self.click(p, 4, 2)
        self.click(p, 4, 0, button=32)
        self.assertEqual(p.top_line, 2)
        self.assertEqual(p.pos, text.index("l2"))
        p.top_line = 0
        self.click(p, 4, 4, button=32)
        self.assertEqual(p.top_line, 1)

    def test_menu_rows_are_not_editable(self):
        self.lines = 6
        p = self.prompt("m:a", 3, complete=[("m:", ["alpha", "beta"])])
        p.render()
        p.screen_origin = 1
        self.assertEqual(p.visible_prompt_rows, 1)
        self.click(p, 6, 2)  # first menu row
        self.assertEqual((p.pos, p.mouse_down, p.selection()), (3, False, None))
        self.assertEqual(p.buf, "m:a")

    def test_mouse_after_resize_waits_for_new_origin(self):
        p = self.prompt(pos=3)
        self.cols = 40
        self.click(p, 9, 1)
        self.assertEqual(p.pos, 3)
        self.assertIsNone(p.screen_origin)
        p.render()
        p.cpr_pending = (p.render_version, p.cursor_row)
        self.feed(p, b"\x1b[1;4R")
        self.click(p, 9, 1)
        self.assertEqual(p.pos, 5)

    def test_cpr_report_sets_origin(self):
        p = self.make("abc")
        p.render()
        self.assertEqual(p.cpr_pending, (p.render_version, p.cursor_row))
        self.feed(p, b"\x1b[7;4R")
        self.assertEqual(p.screen_origin, 7)
        self.assertIsNone(p.cpr_pending)

    def test_stale_cpr_report_ignored(self):
        p = self.make("abc")
        p.render()
        p.render_version += 1
        self.feed(p, b"\x1b[7;4R")
        self.assertIsNone(p.screen_origin)


class ClipboardTests(PromptCase):
    def osc(self, text):
        import base64
        return "\x1b]52;c;" + base64.b64encode(text.encode()).decode() + "\x07"

    def test_cmd_copy_writes_osc52_and_keeps_selection(self):
        for bits in (SUPER, META):
            with self.subTest(bits=bits):
                p = self.select(self.make("hello"), 0, 3)
                self.feed(p, csi(99, bits))
                self.assertEqual(p.term.output, self.osc("hel"))
                self.assertEqual((p.buf, p.kill, p.selection()), ("hello", "hel", (0, 3)))

    def test_copy_without_selection_is_noop(self):
        p = self.make("hello")
        p.kill = "keep"
        self.feed(p, csi(99, SUPER))
        self.assertEqual((p.term.output, p.kill), ("", "keep"))

    def test_copy_unicode_selection(self):
        p = self.select(self.make("你好a"), 2, 0)
        self.feed(p, csi(99, SUPER))
        self.assertEqual(p.term.output, self.osc("你好"))

    def test_cut_copies_deletes_and_undoes_once(self):
        p = self.select(self.make("hello world"), 6, 11)
        self.feed(p, csi(120, SUPER))
        self.assertEqual((p.buf, p.kill, p.selection()), ("hello ", "world", None))
        self.assertEqual(p.term.output, self.osc("world"))
        self.feed(p, csi(122, SUPER))
        self.assertEqual(p.buf, "hello world")

    def test_cut_selection_at_pos_zero(self):
        p = self.select(self.make("hello"), 3, 0)
        self.feed(p, csi(120, SUPER))
        self.assertEqual((p.buf, p.pos, p.kill), ("lo", 0, "hel"))

    def test_cmd_paste_uses_kill_ring_and_replaces_selection(self):
        p = self.select(self.make("hello world"), 0, 5)
        p.kill = "bye"
        self.feed(p, csi(118, SUPER))
        self.assertEqual((p.buf, p.pos, p.selection()), ("bye world", 3, None))
        self.feed(p, csi(122, SUPER))
        self.assertEqual(p.buf, "hello world")

    def test_copy_then_paste_roundtrip(self):
        p = self.select(self.make("abc"), 0, 3)
        self.feed(p, csi(99, SUPER) + arrow("C") + csi(118, SUPER))
        self.assertEqual(p.buf, "abcabc")

    def test_paste_with_empty_kill_ring_is_noop(self):
        p = self.select(self.make("abc"), 0, 2)
        self.feed(p, csi(118, SUPER))
        self.assertEqual((p.buf, p.selection()), ("abc", (0, 2)))

    def test_cmd_select_all_then_type_replaces(self):
        p = self.feed(self.make("abc", 1), csi(97, SUPER) + b"x")
        self.assertEqual(p.buf, "x")

    def test_cmd_shortcuts_not_treated_as_emacs_alt(self):
        p = self.make("foo bar", 7)
        self.feed(p, csi(98, SUPER) + csi(100, SUPER) + csi(104, META))
        self.assertEqual((p.buf, p.pos), ("foo bar", 7))


class MultiClickTests(PromptCase):
    def setUp(self):
        super().setUp()
        self.now = 100.0
        patcher = patch.object(lib.time, "monotonic", side_effect=lambda: self.now)
        patcher.start()
        self.addCleanup(patcher.stop)

    def prompt(self, text, pos=0):
        p = self.make(text, pos)
        p.render()
        p.screen_origin = 1
        return p

    def press(self, p, x, y=1, dt=0.1, button=0):
        self.now += dt
        p.handle_mouse(button, x, y, False)

    def test_double_click_selects_word(self):
        p = self.prompt("foo bar baz")
        self.press(p, 8)  # col 4 -> 'b' of bar
        self.press(p, 8)
        self.assertEqual(p.selection(), (4, 7))
        self.assertEqual(p.mouse_unit, (4, 7))

    def test_double_click_selects_whitespace_and_punctuation_runs(self):
        p = self.prompt("ab   ..cd")
        self.press(p, 7)  # col 3, in spaces
        self.press(p, 7)
        self.assertEqual(p.selection(), (2, 5))
        p = self.prompt("ab   ..cd")
        self.press(p, 9)  # col 5 -> '.'
        self.press(p, 9)
        self.assertEqual(p.selection(), (5, 7))

    def test_double_click_stops_at_newline(self):
        p = self.prompt("ab\ncd")
        self.press(p, 4, 1)
        self.press(p, 4, 1)
        self.assertEqual(p.selection(), (0, 2))

    def test_triple_click_selects_line_with_newline(self):
        p = self.prompt("one two\nthree")
        for _ in range(3):
            self.press(p, 5)
        self.assertEqual(p.selection(), (0, 8))
        p = self.prompt("one\nthree")
        for _ in range(3):
            self.press(p, 5, 2)
        self.assertEqual(p.selection(), (4, 9))

    def test_fourth_click_starts_over(self):
        p = self.prompt("foo bar")
        for _ in range(4):
            self.press(p, 5)
        self.assertIsNone(p.selection())
        self.assertIsNone(p.mouse_unit)

    def test_slow_or_moved_clicks_do_not_multi_click(self):
        p = self.prompt("foo bar")
        self.press(p, 5)
        self.press(p, 5, dt=0.5)
        self.assertIsNone(p.selection())
        self.press(p, 9)
        self.assertIsNone(p.selection())

    def test_shift_click_never_multi_selects(self):
        p = self.prompt("foo bar", 0)
        self.press(p, 9, button=4)
        self.press(p, 9, button=4)
        self.assertIsNone(p.mouse_unit)

    def test_double_click_at_end_of_buffer_has_no_word(self):
        p = self.prompt("foo")
        self.press(p, 40)
        self.press(p, 40)
        self.assertIsNone(p.selection())

    def test_drag_after_double_click_retains_original_word(self):
        p = self.prompt("foo bar baz qux")
        self.press(p, 8)
        self.press(p, 8)
        p.handle_mouse(32, 16, 1, False)  # col 12 -> in 'qux'
        self.assertEqual(p.selection(), (4, 12))
        p.handle_mouse(32, 5, 1, False)  # col 1 -> before the unit
        self.assertEqual(p.selection(), (1, 7))
        self.assertEqual(p.pos, 1)
        self.assertEqual(p.selection_anchor, 7)
        p.handle_mouse(32, 9, 1, False)  # back inside the word
        self.assertEqual(p.selection(), (4, 7))

    def test_unit_held_until_release_then_cleared(self):
        p = self.prompt("foo bar baz")
        self.press(p, 8)
        self.press(p, 8)
        p.handle_mouse(0, 8, 1, True)
        self.assertEqual((p.selection(), p.mouse_down, p.mouse_unit), ((4, 7), False, None))

    def test_drag_after_triple_click_retains_original_line(self):
        p = self.prompt("aa\nbb\ncc")
        for _ in range(3):
            self.press(p, 5, 2)
        self.assertEqual(p.selection(), (3, 6))
        p.handle_mouse(32, 5, 3, False)  # char 7 on the next line
        start, end = p.selection()
        self.assertEqual(start, 3)  # the whole first line stays selected
        self.assertGreaterEqual(end, 7)


class InputReportTests(PromptCase):
    def run_prompt(self, data):
        term = lib._DoctestTerminal(data)
        p = lib.Prompt(term, "P: ", "", "t")
        renders = []
        real = p.render
        p.render = lambda: (renders.append(1), real())[1]
        status = p.run()
        return p, term, status, len(renders)

    def test_matching_cpr_sets_origin_without_redraw(self):
        p, term, status, renders = self.run_prompt(b"\x1b[5;4R\r")
        self.assertEqual((status, renders), (0, 1))
        self.assertEqual(p.screen_origin, 5)
        self.assertEqual(term.output.count("\x1b[6n"), 1)

    def test_normal_key_still_redraws(self):
        _, _, _, renders = self.run_prompt(b"a\r")
        self.assertEqual(renders, 2)

    def test_cpr_after_move_uses_cursor_row_offset(self):
        p = self.make("abc")
        p.render()
        p.cursor_row = 0
        p.cpr_pending = (p.render_version, 2)
        self.feed(p, b"\x1b[9;1R")
        self.assertEqual(p.screen_origin, 7)

    def test_stale_cpr_requeries_without_repaint(self):
        p, term, status, renders = self.run_prompt(b"a\x1b[5;4R\r")
        # 'a' repainted (no new query: one is outstanding); stale reply re-queries.
        self.assertEqual(renders, 2)
        self.assertEqual(term.output.count("\x1b[6n"), 2)
        self.assertIsNone(p.screen_origin)
        self.assertIsNotNone(p.cpr_pending)

    def test_stale_then_fresh_reply_settles(self):
        p, term, _, renders = self.run_prompt(b"a\x1b[5;4R\x1b[6;4R\r")
        self.assertEqual((renders, p.screen_origin, p.cpr_pending), (2, 6, None))
        self.assertEqual(term.output.count("\x1b[6n"), 2)

    def test_unsolicited_cpr_neither_queries_nor_draws(self):
        p, term, _, renders = self.run_prompt(b"\x1b[5;4R\x1b[5;4R\x1b[5;4R\r")
        self.assertEqual(renders, 1)
        self.assertEqual(term.output.count("\x1b[6n"), 1)

    def test_input_report_flag_set_and_reset(self):
        p = self.make("abc")
        p.render()
        self.feed(p, b"\x1b[5;4R")
        self.assertTrue(p.input_report)

    def test_mouse_after_cpr_hits_text(self):
        p, _, _, _ = self.run_prompt(b"\x1b[1;4Rhello\x1b[<0;6;1M\x1b[<0;6;1m\r")
        self.assertEqual(p.screen_origin, 1)
        self.assertEqual(p.pos, 2)

    def test_selection_is_cleared_in_final_render(self):
        term = lib._DoctestTerminal(b"abc\x1b[1;2D\r")
        p = lib.Prompt(term, "P: ", "", "t")
        self.assertEqual(p.run(), 0)
        self.assertTrue(p.final)
        self.assertEqual(p.buf, "abc")
        row = p.split_visual_lines(self.cols)[0]
        self.assertNotIn("\x1b[7m", p.styled_row(row, p.styles(), self.cols))


class CompletionSelectionTests(PromptCase):
    complete = [("m:", ["alpha", "beta"])]

    def test_tab_and_enter_do_not_accept_menu_while_selecting(self):
        p = self.make("m:a", complete=self.complete)
        self.assertIsNotNone(p.menu())
        self.feed(p, arrow("D", SHIFT))
        self.assertEqual(p.selection(), (2, 3))
        self.assertIsNone(p.menu())
        self.feed(p, b"\t")
        self.assertEqual(p.buf, "m:a")
        self.feed(p, b"\r")
        self.assertTrue(p.accepted)
        self.assertEqual(p.buf, "m:a")

    def test_arrows_do_not_move_menu_while_selecting(self):
        p = self.make("m:", complete=self.complete)
        self.assertIsNotNone(p.menu())
        self.feed(p, arrow("D", SHIFT))
        self.assertEqual(p.menu_sel, 0)
        self.feed(p, arrow("B", SHIFT))
        self.assertEqual(p.menu_sel, 0)

    def test_menu_returns_after_collapse_and_escape_clears_selection_first(self):
        p = self.make("m:a", complete=self.complete)
        self.feed(p, arrow("D", SHIFT) + b"\x1b")
        self.assertIsNone(p.selection())
        self.assertFalse(p.cancelled)
        self.feed(p, b"\t")
        self.assertEqual(p.buf, "m:alpha ")

    def test_typing_replaces_selection_not_menu(self):
        p = self.make("m:a", complete=self.complete)
        self.feed(p, arrow("D", SHIFT) + b"b")
        self.assertEqual(p.buf, "m:b")
        self.feed(p, b"\t")
        self.assertEqual(p.buf, "m:beta ")

    def test_render_marks_selection_reverse_video(self):
        p = self.select(self.make("abcd"), 1, 3)
        p.render()
        self.assertIn("\x1b[7mbc", p.term.output)


class SubmitRegressionTests(PromptCase):
    def test_enter_accepts_and_returns_zero(self):
        term = lib._DoctestTerminal(b"hi\r")
        p = lib.Prompt(term, "P: ", "", "t")
        self.assertEqual(p.run(), 0)
        self.assertEqual(p.buf, "hi")

    def test_eof_cancels(self):
        p = lib.Prompt(lib._DoctestTerminal(b"hi"), "P: ", "", "t")
        self.assertEqual(p.run(), 1)

    def test_helpers(self):
        self.assertEqual(lib._edit_for_doctest(b"ab\x7fc\r"), (0, "ac"))
        self.assertEqual(lib._edit_for_doctest(b"a\x03\x03"), (1, ""))

    def test_shift_enter_inserts_newline_plain_enter_accepts(self):
        p = self.feed(self.make(), b"a\x1b[13;2ub\r")
        self.assertEqual((p.buf, p.accepted), ("a\nb", True))

    def test_ctrl_enter_submit_continue(self):
        p = self.make(submit_enabled=True)
        self.feed(p, b"one\x1b[13;5utwo\r")
        self.assertEqual((p.submitted, p.buf, p.accepted), (["one"], "two", True))

    def test_ctrl_enter_without_opt_in_does_not_submit_continue(self):
        p = self.feed(self.make(), b"one\x1b[13;5u")
        self.assertEqual(p.submitted, [])

    def test_submit_after_selection_edit(self):
        p = self.make("hello")
        self.select(p, 0, 5)
        self.feed(p, b"bye\r")
        self.assertEqual((p.buf, p.accepted), ("bye", True))

    def test_submit_continue_clears_selection_and_undo(self):
        p = self.make("", submit_enabled=True)
        self.feed(p, b"hello")
        self.select(p, 0, 3)
        self.feed(p, b"\x1b[13;5u")
        self.assertEqual((p.submitted, p.buf, p.selection(), p.undo), (["hello"], "", None, []))


class CleanupTests(PromptCase):
    class Term(lib._DoctestTerminal):
        def __init__(self, data, boom=False):
            super().__init__(data)
            self.boom = boom
            self.restored = 0

        def restore(self):
            self.restored += 1

        def read_byte(self, timeout=None):
            if self.boom:
                raise RuntimeError("boom")
            return super().read_byte(timeout)

    ENTER = "\x1b[?1002h\x1b[?1006h"
    LEAVE = "\x1b[?1002l\x1b[?1006l\x1b[0 q"

    def test_exit_drains_inflight_reports_before_restoring(self):
        from unittest.mock import Mock
        term = self.Term(b"\r")
        term.discard_input = Mock()
        term.restore = Mock()
        calls = Mock()
        calls.attach_mock(term.discard_input, "discard")
        calls.attach_mock(term.restore, "restore")
        lib.Prompt(term, "P: ", "", "t").run()
        from unittest.mock import call
        self.assertEqual(calls.mock_calls, [call.discard(0.08), call.restore()])

    def test_success_cleans_up(self):
        term = self.Term(b"a\r")
        self.assertEqual(lib.Prompt(term, "P: ", "", "t").run(), 0)
        self.assertIn(self.ENTER, term.output)
        self.assertIn("\x1b[6 q", term.output)
        self.assertTrue(term.output.index(self.LEAVE) > term.output.index(self.ENTER))
        self.assertEqual(term.restored, 1)
        self.assertTrue(term.output.endswith("\r\n"))

    def test_cancel_cleans_up(self):
        term = self.Term(b"\x07")
        self.assertEqual(lib.Prompt(term, "P: ", "", "t").run(), 1)
        self.assertIn(self.LEAVE, term.output)

    def test_exception_cleans_up_and_propagates(self):
        term = self.Term(b"", boom=True)
        with self.assertRaises(RuntimeError):
            lib.Prompt(term, "P: ", "", "t").run()
        self.assertIn(self.LEAVE, term.output)
        self.assertEqual(term.restored, 1)

    def test_exception_in_cleanup_write_still_restores(self):
        term = self.Term(b"a\r")
        real = term.write

        def write(text):
            if "\x1b[<u" in text:
                raise OSError("closed")
            real(text)

        term.write = write
        with self.assertRaises(OSError):
            lib.Prompt(term, "P: ", "", "t").run()
        self.assertEqual(term.restored, 1)

    def test_menu_cleared_on_exit(self):
        term = self.Term(b"m:a\r\r")
        p = lib.Prompt(term, "P: ", "", "t", complete=[("m:", ["alpha", "beta"])])
        self.assertEqual(p.run(), 0)
        self.assertTrue(p.final)
        self.assertEqual(p.buf, "m:alpha ")
        self.assertIn(self.LEAVE, term.output)


if __name__ == "__main__":
    unittest.main()
