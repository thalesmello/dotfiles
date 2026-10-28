#!/usr/bin/env python3
r"""Small raw-mode prompt for herdr popup scripts.

Only Python stdlib is used.  The shell wrapper keeps the old API:

    prompt_line 'Name: ' "$prefill" || exit 0
    name=$PROMPT_LINE

The doctests exercise the same key handlers that the terminal loop uses.
They do not mock the edit operations; they only replace the TTY byte source.

>>> _edit_for_doctest(b"hello\r")
(0, 'hello')
>>> _edit_for_doctest(b"\x7fd\r", initial="abc")
(0, 'abd')
>>> _edit_for_doctest(b"ac\x1b[Db\r")
(0, 'abc')
>>> _edit_for_doctest(b"bc\x01a\x05d\r")
(0, 'abcd')
>>> _edit_for_doctest(b"abc\x02\x02X\x06Y\r")
(0, 'aXbYc')
>>> _edit_for_doctest(b"one two\x1bbX\r")
(0, 'one Xtwo')
>>> _edit_for_doctest(b"one two\x17\r")
(0, 'one ')
>>> _edit_for_doctest(b"\x01\x1bd\r", initial="one two")
(0, ' two')
>>> _edit_for_doctest(b"one two\x1bb\x0bX\x19\r")
(0, 'one Xtwo')
>>> _edit_for_doctest(b"one\x15X\r")
(0, 'X')
>>> _edit_for_doctest(b"ab\x14\r")
(0, 'ba')
>>> _edit_for_doctest(b"\x01\x1bu\r", initial="abc def")
(0, 'ABC def')
>>> _edit_for_doctest(b"\x01\x1bc\r", initial="hello world")
(0, 'Hello world')
>>> _edit_for_doctest(b"ab\x1f\r")
(0, 'a')
>>> _edit_for_doctest(b"a\nb\r")
(0, 'a\nb')
>>> _edit_for_doctest(b"\x1b[200~a\nb\t\x01\x1b[201~\r")
(0, 'a\nb ')
>>> _edit_for_doctest(b"a\x1b[13;2ub\r")
(0, 'a\nb')
>>> _edit_for_doctest(b"\x1b[Hstart \x1b[F end\r", initial="middle")
(0, 'start middle end')
>>> _edit_for_doctest(b"\x1b[D\x1b[3~\r", initial="ab")
(0, 'a')
>>> _edit_for_doctest("é\r".encode())
(0, 'é')
>>> _edit_for_doctest(b"\x03Y\r", initial="X")
(0, 'Y')
>>> _edit_for_doctest(b"\x04")
(1, '')
>>> _edit_for_doctest(b"\x03")
(1, '')
>>> _edit_for_doctest(b"\x07")
(1, '')
>>> _edit_for_doctest(b"\x1b")
(1, '')
>>> sanitize_history_name("Ask: Hello/World!!")
'ask-hello-world'
>>> _history_roundtrip_for_doctest()
'one'

Optional highlighting and token completion (see ``parse_line_options``).
Highlighted words match whole alphanumeric words, case-insensitively; a
completion token is a whitespace-delimited word that starts with its trigger.

>>> _styles_for_doctest("ask Codex in project:pi", highlight=["pi", "codex"])
'    wwwww    cccccccccc'
>>> with _dir_tree_for_doctest("alpha", "beta", "alphabet", ".hidden") as d:
...     _edit_for_doctest(b"go project:al\r\r", complete=[f"project:={d}"])
(0, 'go project:alpha ')
>>> with _dir_tree_for_doctest("alpha", "beta", "alphabet") as d:
...     _edit_for_doctest(b"project:\x0e\x0e\t\r", complete=[f"project:={d}"])
(0, 'project:beta ')
>>> with _dir_tree_for_doctest("alpha", "beta") as d:
...     _edit_for_doctest(b"project:alpha\r", complete=[f"project:={d}"])
(0, 'project:alpha')
>>> with _dir_tree_for_doctest("alpha", "beta") as d:
...     _edit_for_doctest(b"project:b\x1b[27uX\r", complete=[f"project:={d}"])
(0, 'project:bX')
>>> with _dir_tree_for_doctest("movida-modify-book", "beta") as d:
...     _edit_for_doctest(b"project:mmb\r\r", complete=[f"project:={d}"])
(0, 'project:movida-modify-book ')
>>> hl, comp, rest = parse_line_options(["--highlight", "pi,qq", "--complete", "p:=/x", "--", "--label"])
>>> sorted(hl), comp, rest
(['pi', 'qq'], [('p:', '/x')], ['--label'])
"""

from __future__ import annotations

import datetime as _dt
import os
import random
import re
import select
import shutil
import sys
import tempfile
import termios
import time
import unicodedata
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional, Union

ESC = 27
SHOWBREAK = "↪"
PASTE_START = "200~"
PASTE_END = b"\x1b[201~"
MENU_MAX_ROWS = 8
SGR_RESET = "\x1b[0m"
STYLE_SGR = {
    "w": "\x1b[1;36m",  # highlighted word: bold cyan
    "c": "\x1b[1;35m",  # completion token: bold magenta
}
WORD_RE = re.compile(r"[^\W_]+")


class DirSource:
    """Completion candidates: the visible subdirectory names of one directory."""

    def __init__(self, path: str) -> None:
        self.path = os.path.expandvars(os.path.expanduser(path))
        self._names: Optional[list[str]] = None

    def names(self) -> list[str]:
        if self._names is None:
            try:
                entries = os.listdir(self.path)
            except OSError:
                entries = []
            self._names = sorted(
                n
                for n in entries
                if not n.startswith(".")
                and not any(ch.isspace() for ch in n)
                and os.path.isdir(os.path.join(self.path, n))
            )
        return self._names

    def matches(self, query: str) -> list[str]:
        """Prefix matches first, then substring, then in-order subsequence."""
        q = query.lower()
        prefix: list[str] = []
        substring: list[str] = []
        subsequence: list[str] = []
        for name in self.names():
            low = name.lower()
            if low.startswith(q):
                prefix.append(name)
            elif q in low:
                substring.append(name)
            elif _is_subsequence(q, low):
                subsequence.append(name)
        return prefix + substring + subsequence


def _is_subsequence(needle: str, hay: str) -> bool:
    it = iter(hay)
    return all(ch in it for ch in needle)


@dataclass
class VisualLine:
    prefix: str
    text: str
    start: int
    end: int
    final_for_logical: bool

    @property
    def display(self) -> str:
        return self.prefix + self.text


class Terminal:
    def __init__(self) -> None:
        self.in_fd = sys.stdin.fileno()
        self.out_fd = sys.stdout.fileno()
        self.old_attrs: Optional[list[Any]] = None
        self.pending = bytearray()

    def write(self, text: str) -> None:
        os.write(self.out_fd, text.encode("utf-8", "replace"))

    def flush(self) -> None:
        try:
            sys.stdout.flush()
        except Exception:
            pass

    def raw(self) -> None:
        self.old_attrs = termios.tcgetattr(self.in_fd)
        attrs = termios.tcgetattr(self.in_fd)
        # Input: keep bytes as bytes, including Ctrl-C and CR.
        attrs[0] &= ~(getattr(termios, "BRKINT", 0) | getattr(termios, "ICRNL", 0) | getattr(termios, "INPCK", 0) | getattr(termios, "ISTRIP", 0) | getattr(termios, "IXON", 0))
        # Output stays normal so \n still moves to column 0 on terminals that need it.
        attrs[3] &= ~(getattr(termios, "ECHO", 0) | getattr(termios, "ICANON", 0) | getattr(termios, "IEXTEN", 0) | getattr(termios, "ISIG", 0))
        attrs[6][termios.VMIN] = 1
        attrs[6][termios.VTIME] = 0
        termios.tcsetattr(self.in_fd, termios.TCSADRAIN, attrs)

    def restore(self) -> None:
        if self.old_attrs is not None:
            try:
                termios.tcsetattr(self.in_fd, termios.TCSADRAIN, self.old_attrs)
            except Exception:
                pass
            self.old_attrs = None

    def read_byte(self, timeout: Optional[float] = None) -> Optional[int]:
        if self.pending:
            b = self.pending[0]
            del self.pending[0]
            return b
        if timeout is not None:
            ready, _, _ = select.select([self.in_fd], [], [], timeout)
            if not ready:
                return None
        data = os.read(self.in_fd, 1)
        if not data:
            return None
        return data[0]

    def unread(self, data: Union[bytes, bytearray, list[int]]) -> None:
        if isinstance(data, list):
            data = bytes(data)
        self.pending = bytearray(data) + self.pending

    def read_csi_tail(self) -> str:
        data = bytearray()
        while True:
            b = self.read_byte(timeout=0.02)
            if b is None:
                break
            data.append(b)
            if 0x40 <= b <= 0x7E:
                break
        return data.decode("ascii", "ignore")

    def read_utf8_char(self, first: int) -> str:
        need = 0
        if first >= 0xF0:
            need = 3
        elif first >= 0xE0:
            need = 2
        elif first >= 0xC2:
            need = 1
        data = bytearray([first])
        while need:
            b = self.read_byte(timeout=0.05)
            if b is None:
                break
            data.append(b)
            need -= 1
        return data.decode("utf-8", "ignore")

    def read_paste(self) -> str:
        data = bytearray()
        while True:
            ready, _, _ = select.select([self.in_fd], [], [], 1.0)
            if not ready:
                break
            chunk = os.read(self.in_fd, 65536)
            if not chunk:
                break
            data.extend(chunk)
            idx = data.find(PASTE_END)
            if idx >= 0:
                rest = data[idx + len(PASTE_END) :]
                if rest:
                    self.unread(rest)
                data = data[:idx]
                break
        text = data.decode("utf-8", "ignore")
        text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\t", " ")
        return "".join(ch for ch in text if ch == "\n" or (ord(ch) >= 32 and ord(ch) != 127))


def char_width(ch: str) -> int:
    if not ch:
        return 0
    if unicodedata.combining(ch):
        return 0
    cat = unicodedata.category(ch)
    if cat.startswith("C"):
        return 0
    if unicodedata.east_asian_width(ch) in {"F", "W"}:
        return 2
    return 1


def display_width(s: str) -> int:
    return sum(char_width(ch) for ch in s)


def is_word(ch: str) -> bool:
    return bool(ch) and ch.isalnum()


def sanitize_history_name(raw: str) -> str:
    raw = (raw or "prompt").lower()
    raw = re.sub(r"[^a-z0-9_.-]+", "-", raw)
    raw = re.sub(r"-+", "-", raw).strip("-")
    raw = raw[:64].rstrip("-")
    return raw or "prompt"


class History:
    def __init__(self, name: str) -> None:
        self.enabled = os.environ.get("PROMPT_LIB_HISTORY", "1") != "0"
        self.active = False
        self.draft = ""
        self.index = 0
        self.files: list[Path] = []
        self.dir: Optional[Path] = None
        if not self.enabled:
            return
        state = Path(os.environ.get("XDG_STATE_HOME") or (Path.home() / ".local" / "state"))
        self.dir = state / "prompt-lib" / sanitize_history_name(name)
        try:
            self.dir.mkdir(mode=0o700, parents=True, exist_ok=True)
            try:
                (state / "prompt-lib").chmod(0o700)
                self.dir.chmod(0o700)
            except OSError:
                pass
            self.refresh()
            self.index = len(self.files)
        except OSError:
            self.enabled = False
            self.dir = None

    def refresh(self) -> None:
        if not self.dir:
            self.files = []
            return
        try:
            self.files = sorted(self.dir.glob("*.prompt"))
        except OSError:
            self.files = []

    def edit_mode(self) -> None:
        self.active = False
        self.index = len(self.files)

    def move(self, direction: int, current: str) -> Optional[str]:
        if not self.enabled or not self.files:
            return None
        n = len(self.files)
        if not self.active:
            self.draft = current
            self.index = n
            self.active = True
        if direction < 0:
            if self.index <= 0:
                return None
            self.index -= 1
        else:
            if self.index >= n:
                return None
            self.index += 1
        if self.index == n:
            return self.draft
        try:
            return self.files[self.index].read_text(encoding="utf-8", errors="ignore")
        except OSError:
            return None

    def save(self, text: str) -> None:
        if not self.enabled or not self.dir or not text:
            return
        try:
            self.refresh()
            if self.files:
                try:
                    if self.files[-1].read_text(encoding="utf-8", errors="ignore") == text:
                        return
                except OSError:
                    pass
            ns = time.time_ns()
            sec, frac = divmod(ns, 1_000_000_000)
            now = _dt.datetime.fromtimestamp(sec, _dt.timezone.utc)
            stamp = now.strftime("%Y%m%dT%H%M%S") + f".{frac:09d}"
            name = f"{stamp}.{os.getpid()}.{random.randint(0, 999999)}.prompt"
            path = self.dir / name
            flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
            fd = os.open(path, flags, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(text)
            limit_s = os.environ.get("PROMPT_LIB_HISTORY_LIMIT", "200")
            try:
                limit = int(limit_s)
                if limit <= 0:
                    limit = 200
            except ValueError:
                limit = 200
            self.refresh()
            excess = len(self.files) - limit
            for old in self.files[: max(0, excess)]:
                try:
                    old.unlink()
                except OSError:
                    pass
        except OSError:
            return


class Prompt:
    def __init__(
        self,
        term: Terminal,
        label: str,
        prefill: str,
        history_name: str,
        highlight: Optional[set[str]] = None,
        complete: Optional[list[tuple[str, str]]] = None,
    ) -> None:
        self.term = term
        self.highlight = {w.lower() for w in (highlight or ())}
        self.completions = [(trig, DirSource(path)) for trig, path in (complete or [])]
        self.menu_sel = 0
        self.menu_top = 0
        self.menu_query: Optional[str] = None
        self.menu_dismissed: Optional[int] = None
        self.menu_shown = False
        self.final = False
        self.label = label
        self.label_width = display_width(label)
        self.label_spaces = " " * self.label_width
        self.buf = prefill
        self.pos = len(prefill)
        self.kill = ""
        self.undo: list[tuple[str, int]] = []
        self.history = History(history_name)
        self.rendered_rows = 0
        self.cursor_row = 0
        self.cursor_col = 0
        self.top_line = 0
        self.goal_col: Optional[int] = None
        self.cancelled = False
        self.accepted = False

    def save_undo(self) -> None:
        self.undo.append((self.buf, self.pos))

    def edit_mode(self) -> None:
        self.history.edit_mode()
        self.goal_col = None

    def insert(self, text: str) -> None:
        if not text:
            return
        self.edit_mode()
        self.save_undo()
        self.buf = self.buf[: self.pos] + text + self.buf[self.pos :]
        self.pos += len(text)

    def delete(self, at: int, length: int, ring: bool = False) -> None:
        if length <= 0 or at < 0 or at >= len(self.buf):
            return
        length = min(length, len(self.buf) - at)
        if ring:
            self.kill = self.buf[at : at + length]
        self.edit_mode()
        self.save_undo()
        self.buf = self.buf[:at] + self.buf[at + length :]
        if self.pos > at:
            self.pos = at

    def undo_last(self) -> None:
        if not self.undo:
            return
        self.buf, self.pos = self.undo.pop()
        self.history.edit_mode()

    def word_back(self, pos: int) -> int:
        i = pos
        while i > 0 and not is_word(self.buf[i - 1]):
            i -= 1
        while i > 0 and is_word(self.buf[i - 1]):
            i -= 1
        return i

    def word_fwd(self, pos: int) -> int:
        i = pos
        n = len(self.buf)
        while i < n and not is_word(self.buf[i]):
            i += 1
        while i < n and is_word(self.buf[i]):
            i += 1
        return i

    def line_start_at(self, pos: int) -> int:
        i = pos
        while i > 0 and self.buf[i - 1] != "\n":
            i -= 1
        return i

    def line_end_at(self, pos: int) -> int:
        i = pos
        n = len(self.buf)
        while i < n and self.buf[i] != "\n":
            i += 1
        return i

    def move_line_start(self) -> None:
        self.edit_mode()
        at = self.line_start_at(self.pos)
        self.pos = 0 if self.pos == at and self.pos > 0 else at

    def move_line_end(self) -> None:
        self.edit_mode()
        at = self.line_end_at(self.pos)
        self.pos = len(self.buf) if self.pos == at and self.pos < len(self.buf) else at

    def move_char_left(self) -> None:
        self.edit_mode()
        if self.pos > 0:
            self.pos -= 1

    def move_char_right(self) -> None:
        self.edit_mode()
        if self.pos < len(self.buf):
            self.pos += 1

    def move_word_left(self) -> None:
        self.edit_mode()
        self.pos = self.word_back(self.pos)

    def move_word_right(self) -> None:
        self.edit_mode()
        self.pos = self.word_fwd(self.pos)

    # --- completion menu -------------------------------------------------

    def completion_context(self) -> Optional[tuple[int, str, DirSource, str]]:
        """(token start, trigger, source, query) for the token ending at the cursor."""
        if not self.completions or self.history.active:
            return None
        start = self.pos
        while start > 0 and not self.buf[start - 1].isspace():
            start -= 1
        token = self.buf[start : self.pos]
        for trig, source in self.completions:
            if token.startswith(trig):
                return start, trig, source, token[len(trig) :]
        return None

    def menu(self) -> Optional[tuple[tuple[int, str, DirSource, str], list[str]]]:
        ctx = self.completion_context()
        if ctx is None:
            self.menu_dismissed = None
            self.menu_query = None
            return None
        start, _trig, source, query = ctx
        if self.menu_dismissed == start:
            return None
        cands = source.matches(query)
        # An exact, already-typed name needs no menu: Enter should submit.
        if not cands or query in cands:
            return None
        if query != self.menu_query:
            self.menu_query = query
            self.menu_sel = 0
            self.menu_top = 0
        self.menu_sel = max(0, min(self.menu_sel, len(cands) - 1))
        return ctx, cands

    def menu_move(self, direction: int) -> bool:
        m = self.menu()
        if m is None:
            return False
        self.menu_sel = (self.menu_sel + direction) % len(m[1])
        return True

    def menu_accept(self) -> bool:
        m = self.menu()
        if m is None:
            return False
        (start, trig, _source, _query), cands = m
        value_at = start + len(trig)
        end = self.pos
        while end < len(self.buf) and not self.buf[end].isspace():
            end += 1
        choice = cands[self.menu_sel]
        tail = self.buf[end:]
        sep = "" if tail[:1].isspace() else " "
        self.edit_mode()
        self.save_undo()
        self.buf = self.buf[:value_at] + choice + sep + tail
        self.pos = value_at + len(choice) + len(sep)
        self.menu_dismissed = start
        return True

    def escape(self) -> None:
        """Esc closes an open completion menu; otherwise clear, then cancel."""
        m = self.menu()
        if m is not None:
            self.menu_dismissed = m[0][0]
            return
        self.clear_or_cancel()

    def styles(self) -> list[Optional[str]]:
        out: list[Optional[str]] = [None] * len(self.buf)
        if self.highlight:
            for m in WORD_RE.finditer(self.buf):
                if m.group(0).lower() in self.highlight:
                    out[m.start() : m.end()] = ["w"] * (m.end() - m.start())
        for trig, _source in self.completions:
            for m in re.finditer(r"(?<!\S)" + re.escape(trig) + r"\S*", self.buf):
                out[m.start() : m.end()] = ["c"] * (m.end() - m.start())
        return out

    def move_history_or_vertical(self, direction: int) -> None:
        if self.menu_move(direction):
            return
        if self.history.enabled and (not self.buf or self.history.active):
            text = self.history.move(direction, self.buf)
            if text is not None:
                self.buf = text
                self.pos = len(text)
                self.top_line = 0
            return
        self.move_vertical(direction)

    def visual_col_in_logical_line(self, pos: int) -> int:
        start = self.line_start_at(pos)
        return display_width(self.buf[start:pos])

    def pos_for_visual_col(self, start: int, end: int, target: int) -> int:
        col = 0
        best = start
        for i in range(start, end):
            w = char_width(self.buf[i])
            if col + max(w, 1) > target:
                return best
            col += w
            best = i + 1
        return best

    def move_vertical(self, direction: int) -> None:
        if self.goal_col is None:
            self.goal_col = self.visual_col_in_logical_line(self.pos)
        start = self.line_start_at(self.pos)
        end = self.line_end_at(self.pos)
        if direction < 0:
            if start == 0:
                return
            prev_end = start - 1
            prev_start = self.line_start_at(prev_end)
            self.pos = self.pos_for_visual_col(prev_start, prev_end, self.goal_col)
        else:
            if end >= len(self.buf):
                return
            next_start = end + 1
            next_end = self.line_end_at(next_start)
            self.pos = self.pos_for_visual_col(next_start, next_end, self.goal_col)
        self.history.edit_mode()

    def backspace(self) -> None:
        if self.pos <= 0:
            return
        self.delete(self.pos - 1, 1)

    def delete_forward(self) -> None:
        self.delete(self.pos, 1)

    def clear_or_cancel(self) -> None:
        if not self.buf:
            self.cancelled = True
            return
        self.history.active = False
        self.history.index = len(self.history.files)
        self.save_undo()
        self.buf = ""
        self.pos = 0

    def case_word(self, mode: str) -> None:
        end = self.word_fwd(self.pos)
        if end <= self.pos:
            return
        old = self.buf[self.pos : end]
        if mode == "up":
            new = old.upper()
        elif mode == "down":
            new = old.lower()
        else:
            lower = old.lower()
            chars = list(lower)
            for i, ch in enumerate(chars):
                if is_word(ch):
                    chars[i] = ch.upper()
                    break
            new = "".join(chars)
        if new != old:
            self.edit_mode()
            self.save_undo()
            self.buf = self.buf[: self.pos] + new + self.buf[end:]
        self.pos = end

    def transpose_chars(self) -> None:
        n = len(self.buf)
        at = self.pos
        if n < 2:
            return
        if at >= n:
            at = n - 1
        if at < 1:
            return
        a, b = self.buf[at - 1], self.buf[at]
        if a != b:
            self.edit_mode()
            self.save_undo()
        self.buf = self.buf[: at - 1] + b + a + self.buf[at + 1 :]
        self.pos = at + 1

    def transpose_words(self) -> None:
        n = len(self.buf)
        if n == 0:
            return
        w2_start = self.pos
        if w2_start < n and is_word(self.buf[w2_start]):
            while w2_start > 0 and is_word(self.buf[w2_start - 1]):
                w2_start -= 1
        else:
            while w2_start < n and not is_word(self.buf[w2_start]):
                w2_start += 1
        w2_end = w2_start
        while w2_end < n and is_word(self.buf[w2_end]):
            w2_end += 1
        if w2_start >= w2_end:
            w1_end = self.pos
        else:
            w1_end = w2_start
        while w1_end > 0 and not is_word(self.buf[w1_end - 1]):
            w1_end -= 1
        w1_start = w1_end
        while w1_start > 0 and is_word(self.buf[w1_start - 1]):
            w1_start -= 1
        if w1_start >= w1_end or w2_start >= w2_end or w1_start == w2_start:
            return
        w1 = self.buf[w1_start:w1_end]
        mid = self.buf[w1_end:w2_start]
        w2 = self.buf[w2_start:w2_end]
        self.edit_mode()
        self.save_undo()
        self.buf = self.buf[:w1_start] + w2 + mid + w1 + self.buf[w2_end:]
        self.pos = w2_end

    def handle_control(self, b: int) -> None:
        if b == 1:
            self.move_line_start()
        elif b == 5:
            self.move_line_end()
        elif b == 2:
            self.move_char_left()
        elif b == 6:
            self.move_char_right()
        elif b in (8, 127):
            self.backspace()
        elif b == 4:
            if not self.buf:
                self.cancelled = True
            else:
                self.delete_forward()
        elif b == 23:
            at = self.word_back(self.pos)
            self.delete(at, self.pos - at, ring=True)
        elif b == 21:
            self.delete(0, self.pos, ring=True)
        elif b == 11:
            self.delete(self.pos, len(self.buf) - self.pos, ring=True)
        elif b == 25:
            self.insert(self.kill)
        elif b == 14:
            self.move_history_or_vertical(1)
        elif b == 16:
            self.move_history_or_vertical(-1)
        elif b == 20:
            self.transpose_chars()
        elif b == 31:
            self.undo_last()
        elif b == 9:
            self.menu_accept()
        elif b == 12:
            pass
        elif b == 7:
            self.cancelled = True
        elif b == 3:
            self.clear_or_cancel()

    def handle_csi_prompt_key(self, tail: str) -> bool:
        mods = 1
        key_part = ""
        event = "1"
        if tail.endswith("u"):
            body = tail[:-1]
            if ";" in body:
                key_part, rest = body.split(";", 1)
                mods_s = re.split(r"[;:]", rest, maxsplit=1)[0]
                try:
                    mods = int(mods_s)
                except ValueError:
                    return False
                after = rest[len(mods_s) :]
                if after.startswith(":"):
                    event = after[1:].split(";", 1)[0]
            else:
                key_part = body
        elif tail.startswith("27;") and tail.endswith("~"):
            body = tail[:-1][3:]
            bits = body.split(";")
            if len(bits) < 2:
                return False
            try:
                mods = int(bits[0])
            except ValueError:
                return False
            key_part = bits[1]
        else:
            return False
        if event == "3":
            return True
        mod_bits = mods - 1
        codes: list[int] = []
        for part in key_part.split(":"):
            try:
                codes.append(int(part))
            except ValueError:
                pass
        for code in codes:
            lower = code + 32 if 65 <= code <= 90 else code
            if code == 9:
                if mod_bits & 1:
                    self.menu_move(-1)
                else:
                    self.menu_accept()
                return True
            if code in (8, 127):
                if mod_bits & 62:
                    at = self.word_back(self.pos)
                    self.delete(at, self.pos - at, ring=True)
                else:
                    self.backspace()
                return True
            if code in (13, 57414):
                if mod_bits & 3:
                    self.insert("\n")
                elif not self.menu_accept():
                    self.accepted = True
                return True
            if code == 57417:
                self.move_word_left() if (mod_bits & 62) else self.move_char_left()
                return True
            if code == 57418:
                self.move_word_right() if (mod_bits & 62) else self.move_char_right()
                return True
            if code == 57419:
                self.move_history_or_vertical(-1)
                return True
            if code == 57420:
                self.move_history_or_vertical(1)
                return True
            if code == 57423:
                self.move_line_start()
                return True
            if code == 57424:
                self.move_line_end()
                return True
            if code == 27:
                self.escape()
                return True
            if mod_bits & 58:
                if lower == 98:
                    self.move_word_left(); return True
                if lower == 102:
                    self.move_word_right(); return True
                if lower == 110:
                    self.move_history_or_vertical(1); return True
                if lower == 112:
                    self.move_history_or_vertical(-1); return True
                if lower == 100:
                    at = self.word_fwd(self.pos); self.delete(self.pos, at - self.pos, ring=True); return True
                if lower == 104:
                    at = self.word_back(self.pos); self.delete(at, self.pos - at, ring=True); return True
                if lower == 116:
                    self.transpose_words(); return True
                if lower == 117:
                    self.case_word("up"); return True
                if lower == 108:
                    self.case_word("down"); return True
                if lower == 99:
                    self.case_word("cap"); return True
                if lower == 60:
                    self.edit_mode(); self.pos = 0; return True
                if lower == 62:
                    self.edit_mode(); self.pos = len(self.buf); return True
            if mod_bits & 4:
                self.handle_control({97:1, 98:2, 99:3, 100:4, 101:5, 102:6, 103:7, 104:8, 107:11, 108:12, 110:14, 112:16, 116:20, 117:21, 119:23, 121:25}.get(lower, lower))
                if lower in (31, 45, 47, 63, 95):
                    self.undo_last()
                return True
        return False

    def handle_csi(self, tail: str) -> None:
        if tail == PASTE_START:
            self.insert(self.term.read_paste())
            return
        if tail.endswith("u") or (tail.startswith("27;") and tail.endswith("~")):
            if self.handle_csi_prompt_key(tail):
                return
        if re.fullmatch(r"(?:\d+(?:;\d+)?|1;\d+)?[CD]", tail):
            mod = 1
            m = re.search(r";(\d+)(?::\d+)?[CD]$", tail)
            if m:
                mod = int(m.group(1))
            if (mod - 1) & 62:
                self.move_word_right() if tail.endswith("C") else self.move_word_left()
            else:
                self.move_char_right() if tail.endswith("C") else self.move_char_left()
        elif tail in ("H", "1~", "1;1H") or re.fullmatch(r"1;\d+H", tail):
            self.move_line_start()
        elif tail in ("F", "4~", "1;1F") or re.fullmatch(r"1;\d+F", tail):
            self.move_line_end()
        elif tail == "Z":
            self.menu_move(-1)
        elif tail == "3~":
            self.delete_forward()
        elif re.fullmatch(r"3;\d+~", tail):
            at = self.word_fwd(self.pos)
            self.delete(self.pos, at - self.pos, ring=True)
        elif re.fullmatch(r"(?:\d+)?A", tail):
            self.move_history_or_vertical(-1)
        elif re.fullmatch(r"(?:\d+)?B", tail):
            self.move_history_or_vertical(1)

    def handle_escape(self) -> None:
        nxt = self.term.read_byte(timeout=0.2)
        if nxt is None:
            self.escape()
            return
        if nxt in (10, 13):
            self.insert("\n")
        elif nxt == ord("["):
            self.handle_csi(self.term.read_csi_tail())
        elif nxt == ESC:
            nxt2 = self.term.read_byte(timeout=0.2)
            if nxt2 is None:
                self.escape()
            elif nxt2 == ord("["):
                tail = self.term.read_csi_tail()
                if tail.endswith("C"):
                    self.move_word_right()
                elif tail.endswith("D"):
                    self.move_word_left()
            elif nxt2 == ord("O"):
                self.handle_ss3()
        elif nxt == ord("O"):
            self.handle_ss3()
        else:
            lower = nxt + 32 if 65 <= nxt <= 90 else nxt
            if lower == ord("b"):
                self.move_word_left()
            elif lower == ord("f"):
                self.move_word_right()
            elif lower == ord("n"):
                self.move_history_or_vertical(1)
            elif lower == ord("p"):
                self.move_history_or_vertical(-1)
            elif lower == ord("d"):
                at = self.word_fwd(self.pos); self.delete(self.pos, at - self.pos, ring=True)
            elif nxt in (8, 127):
                at = self.word_back(self.pos); self.delete(at, self.pos - at, ring=True)
            elif lower == ord("t"):
                self.transpose_words()
            elif lower == ord("u"):
                self.case_word("up")
            elif lower == ord("l"):
                self.case_word("down")
            elif lower == ord("c"):
                self.case_word("cap")
            elif nxt == ord("<"):
                self.edit_mode(); self.pos = 0
            elif nxt == ord(">"):
                self.edit_mode(); self.pos = len(self.buf)

    def handle_ss3(self) -> None:
        b = self.term.read_byte(timeout=0.02)
        if b == ord("A"):
            self.move_history_or_vertical(-1)
        elif b == ord("B"):
            self.move_history_or_vertical(1)
        elif b == ord("C"):
            self.move_char_right()
        elif b == ord("D"):
            self.move_char_left()
        elif b == ord("H"):
            self.move_line_start()
        elif b == ord("F"):
            self.move_line_end()

    def split_visual_lines(self, cols: int) -> list[VisualLine]:
        rows: list[VisualLine] = []
        n = len(self.buf)
        logical_start = 0
        first_logical = True
        while True:
            logical_end = self.buf.find("\n", logical_start)
            has_newline = logical_end >= 0
            if logical_end < 0:
                logical_end = n
            pos = logical_start
            first_visual = True
            while True:
                if first_visual:
                    prefix = self.label if first_logical else self.label_spaces
                else:
                    prefix = self.label_spaces + SHOWBREAK
                avail = max(1, cols - display_width(prefix))
                width = 0
                end = pos
                last_break: Optional[int] = None
                while end < logical_end:
                    ch = self.buf[end]
                    w = char_width(ch)
                    if end > pos and width + w > avail:
                        break
                    if end == pos and width + w > avail:
                        end += 1
                        break
                    width += w
                    end += 1
                    if ch.isspace() or ch in "-_,.;:/\\|)]}":
                        last_break = end
                if end < logical_end and last_break is not None and last_break > pos:
                    end = last_break
                final = end >= logical_end
                rows.append(VisualLine(prefix, self.buf[pos:end], pos, end, final))
                first_visual = False
                pos = end
                if final:
                    break
            if not has_newline:
                break
            logical_start = logical_end + 1
            first_logical = False
            if logical_start > n:
                break
        if not rows:
            rows.append(VisualLine(self.label, "", 0, 0, True))
        return rows

    def cursor_in_rows(self, rows: list[VisualLine]) -> tuple[int, int]:
        fallback = (0, self.label_width)
        for i, row in enumerate(rows):
            if row.start <= self.pos <= row.end:
                # At a soft wrap boundary, show the cursor at the start of the next row
                # when such a row starts at the same buffer position.
                if self.pos == row.end and not row.final_for_logical and i + 1 < len(rows) and rows[i + 1].start == self.pos:
                    continue
                col = display_width(row.prefix) + display_width(self.buf[row.start : self.pos])
                return i, col
            fallback = (i, display_width(row.display))
        return fallback

    def styled_row(self, row: VisualLine, styles: list[Optional[str]], cols: int) -> str:
        # Cut by cells so a very wide glyph cannot spill after a resize.
        out: list[str] = []
        w = 0
        for ch in row.prefix:
            cw = char_width(ch)
            if w + cw > cols:
                return "".join(out)
            out.append(ch)
            w += cw
        current: Optional[str] = None
        for i, ch in enumerate(row.text):
            cw = char_width(ch)
            if w + cw > cols:
                break
            style = styles[row.start + i] if row.start + i < len(styles) else None
            if style != current:
                out.append(SGR_RESET if style is None else STYLE_SGR[style])
                current = style
            out.append(ch)
            w += cw
        if current is not None:
            out.append(SGR_RESET)
        return "".join(out)

    def menu_lines(self, cands: list[str], count: int, cols: int) -> list[str]:
        if self.menu_sel < self.menu_top:
            self.menu_top = self.menu_sel
        elif self.menu_sel >= self.menu_top + count:
            self.menu_top = self.menu_sel - count + 1
        self.menu_top = max(0, min(self.menu_top, len(cands) - count))
        indent = self.label_spaces[: max(0, cols - 4)]
        lines = []
        for i in range(self.menu_top, self.menu_top + count):
            text = ("› " if i == self.menu_sel else "  ") + cands[i]
            more = (i == self.menu_top + count - 1) and (i < len(cands) - 1)
            if more:
                text += f"  (+{len(cands) - 1 - i})"
            avail = max(1, cols - display_width(indent))
            text = text[:avail]
            if i == self.menu_sel:
                lines.append(indent + "\x1b[7m" + text + SGR_RESET)
            else:
                lines.append(indent + "\x1b[2m" + text + SGR_RESET)
        return lines

    def render(self) -> None:
        size = shutil.get_terminal_size((80, 24))
        cols = max(1, size.columns)
        max_rows = max(1, size.lines)
        menu = None if self.final else self.menu()
        cands = menu[1] if menu else []
        menu_count = min(len(cands), MENU_MAX_ROWS, max_rows - 1)
        if menu_count > 0:
            self.menu_shown = True
        prompt_rows = max(1, max_rows - menu_count)
        rows = self.split_visual_lines(cols)
        cursor_abs, cursor_col = self.cursor_in_rows(rows)
        if cursor_abs < self.top_line:
            self.top_line = cursor_abs
        elif cursor_abs >= self.top_line + prompt_rows:
            self.top_line = cursor_abs - prompt_rows + 1
        render_count = min(prompt_rows, len(rows))
        self.top_line = max(0, min(self.top_line, max(0, len(rows) - render_count)))
        visible = rows[self.top_line : self.top_line + render_count]
        cursor_row = max(0, min(cursor_abs - self.top_line, len(visible) - 1))
        cursor_col = min(cursor_col, cols - 1)

        out: list[str] = ["\x1b[?25l"]
        if self.rendered_rows:
            out.append("\r")
            if self.cursor_row:
                out.append(f"\x1b[{self.cursor_row}A")
        else:
            out.append("\r")
        styles = self.styles()
        lines = [self.styled_row(row, styles, cols) for row in visible]
        if menu_count > 0:
            lines.extend(self.menu_lines(cands, menu_count, cols))
        total = max(self.rendered_rows, len(lines), 1)
        for i in range(total):
            out.append("\r\x1b[K")
            if i < len(lines):
                out.append(lines[i])
            if i < total - 1:
                out.append("\n")
        up = total - 1 - cursor_row
        if up > 0:
            out.append(f"\x1b[{up}A")
        out.append("\r")
        if cursor_col > 0:
            out.append(f"\x1b[{cursor_col}C")
        out.append("\x1b[?25h")
        self.term.write("".join(out))
        self.rendered_rows = len(lines)
        self.cursor_row = cursor_row
        self.cursor_col = cursor_col

    def finish_render(self) -> None:
        down = max(0, self.rendered_rows - 1 - self.cursor_row)
        out = ["\x1b[?25h"]
        if down:
            out.append(f"\x1b[{down}B")
        out.append("\r\n")
        self.term.write("".join(out))

    def handle_byte(self, b: int) -> bool:
        """Apply one input byte; True when the prompt is accepted or cancelled."""
        if b == ESC:
            self.handle_escape()
        elif b == 10:
            self.insert("\n")
        elif b == 13:
            if not self.menu_accept():
                self.accepted = True
        elif b < 32 or b == 127:
            self.handle_control(b)
        else:
            self.insert(self.term.read_utf8_char(b))
        return self.accepted or self.cancelled

    def run(self) -> int:
        self.term.raw()
        self.term.write("\x1b[?2004h\x1b[>5u")
        try:
            self.render()
            while True:
                b = self.term.read_byte()
                if b is None:
                    self.cancelled = True
                    break
                if self.handle_byte(b):
                    break
                self.render()
            if self.menu_shown:
                # Clear the menu rows so later popup output starts clean.
                self.final = True
                self.render()
            self.term.write("\x1b[<u\x1b[?2004l")
        finally:
            self.term.restore()
            self.finish_render()
        if self.cancelled:
            return 1
        self.history.save(self.buf)
        return 0


class _DoctestTerminal:
    def __init__(self, data: bytes) -> None:
        self.pending = bytearray(data)
        self.output = ""

    def write(self, text: str) -> None:
        self.output += text

    def raw(self) -> None:
        pass

    def restore(self) -> None:
        pass

    def unread(self, data: Union[bytes, bytearray, list[int]]) -> None:
        if isinstance(data, list):
            data = bytes(data)
        self.pending = bytearray(data) + self.pending

    def read_byte(self, timeout: Optional[float] = None) -> Optional[int]:
        if not self.pending:
            return None
        b = self.pending[0]
        del self.pending[0]
        return b

    def read_csi_tail(self) -> str:
        data = bytearray()
        while self.pending:
            b = self.read_byte()
            if b is None:
                break
            data.append(b)
            if 0x40 <= b <= 0x7E:
                break
        return data.decode("ascii", "ignore")

    def read_utf8_char(self, first: int) -> str:
        need = 0
        if first >= 0xF0:
            need = 3
        elif first >= 0xE0:
            need = 2
        elif first >= 0xC2:
            need = 1
        data = bytearray([first])
        while need and self.pending:
            b = self.read_byte()
            if b is None:
                break
            data.append(b)
            need -= 1
        return data.decode("utf-8", "ignore")

    def read_paste(self) -> str:
        data = bytearray()
        while self.pending:
            data.append(self.read_byte() or 0)
            idx = data.find(PASTE_END)
            if idx >= 0:
                rest = data[idx + len(PASTE_END) :]
                if rest:
                    self.unread(rest)
                data = data[:idx]
                break
        text = data.decode("utf-8", "ignore")
        text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\t", " ")
        return "".join(ch for ch in text if ch == "\n" or (ord(ch) >= 32 and ord(ch) != 127))


def _edit_for_doctest(
    data: bytes,
    initial: str = "",
    label: str = "P: ",
    highlight: Optional[list[str]] = None,
    complete: Optional[list[str]] = None,
) -> tuple[int, str]:
    old_history = os.environ.get("PROMPT_LIB_HISTORY")
    os.environ["PROMPT_LIB_HISTORY"] = "0"
    try:
        term = _DoctestTerminal(data)
        prompt = Prompt(
            term, label, initial, "doctest",
            highlight=set(highlight or ()),
            complete=[_parse_complete(c) for c in (complete or [])],
        )
        while True:
            b = term.read_byte()
            if b is None:
                prompt.cancelled = True
                break
            if prompt.handle_byte(b):
                break
        return (1 if prompt.cancelled else 0, prompt.buf)
    finally:
        if old_history is None:
            os.environ.pop("PROMPT_LIB_HISTORY", None)
        else:
            os.environ["PROMPT_LIB_HISTORY"] = old_history


def _styles_for_doctest(text: str, highlight: list[str]) -> str:
    prompt = Prompt(_DoctestTerminal(b""), "", text, "doctest", highlight=set(highlight), complete=[("project:", "/nonexistent")])
    return "".join(s or " " for s in prompt.styles())


@contextmanager
def _dir_tree_for_doctest(*names: str):
    with tempfile.TemporaryDirectory() as root:
        for name in names:
            os.mkdir(os.path.join(root, name))
        yield root


def _history_roundtrip_for_doctest() -> str:
    old_state = os.environ.get("XDG_STATE_HOME")
    old_history = os.environ.get("PROMPT_LIB_HISTORY")
    try:
        with tempfile.TemporaryDirectory() as state:
            os.environ["XDG_STATE_HOME"] = state
            os.environ["PROMPT_LIB_HISTORY"] = "1"
            first = History("Ask: History")
            first.save("one")
            second = History("Ask: History")
            return second.move(-1, "") or ""
    finally:
        if old_state is None:
            os.environ.pop("XDG_STATE_HOME", None)
        else:
            os.environ["XDG_STATE_HOME"] = old_state
        if old_history is None:
            os.environ.pop("PROMPT_LIB_HISTORY", None)
        else:
            os.environ["PROMPT_LIB_HISTORY"] = old_history


def _parse_complete(spec: str) -> tuple[str, str]:
    trigger, sep, path = spec.partition("=")
    if not sep or not trigger or not path:
        raise ValueError(f"--complete expects TRIGGER=DIR, got {spec!r}")
    return trigger, path


def parse_line_options(argv: list[str]) -> tuple[set[str], list[tuple[str, str]], list[str]]:
    """Split leading options from the positional `line` arguments.

    --highlight WORDS   comma-separated words to highlight (repeatable)
    --complete T=DIR    a word starting with T opens a menu of DIR's
                        subdirectories, filtered by what follows T (repeatable)
    --                  end of options
    """
    highlight: set[str] = set()
    complete: list[tuple[str, str]] = []
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--":
            i += 1
            break
        if arg in ("--highlight", "--complete"):
            if i + 1 >= len(argv):
                raise ValueError(f"{arg} needs a value")
            value = argv[i + 1]
            if arg == "--highlight":
                highlight.update(w.strip().lower() for w in value.split(",") if w.strip())
            else:
                complete.append(_parse_complete(value))
            i += 2
            continue
        break
    return highlight, complete, argv[i:]


def prompt_line(argv: list[str]) -> int:
    try:
        highlight, complete, argv = parse_line_options(argv)
    except ValueError as e:
        print(f"prompt-lib: {e}", file=sys.stderr)
        return 2
    label = argv[0] if len(argv) >= 1 else ""
    prefill = argv[1] if len(argv) >= 2 else ""
    if os.environ.get("PROMPT_LIB_HISTORY_NAME"):
        history_name = os.environ["PROMPT_LIB_HISTORY_NAME"]
    elif len(argv) >= 3:
        history_name = argv[2]
    else:
        history_name = label
    term = Terminal()
    prompt = Prompt(term, label, prefill, history_name, highlight=highlight, complete=complete)
    status = prompt.run()
    result_file = os.environ.get("PROMPT_LIB_RESULT_FILE")
    if status == 0 and result_file:
        try:
            Path(result_file).write_text(prompt.buf, encoding="utf-8")
        except OSError:
            return 1
    return status


def prompt_any_key(argv: list[str]) -> int:
    term = Terminal()
    if argv:
        term.write(argv[0])
    term.raw()
    try:
        term.read_byte()
    finally:
        term.restore()
    return 0


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: prompt-lib.py line|any-key ...", file=sys.stderr)
        return 2
    cmd = sys.argv[1]
    if cmd == "line":
        return prompt_line(sys.argv[2:])
    if cmd == "any-key":
        return prompt_any_key(sys.argv[2:])
    print(f"unknown command: {cmd}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
