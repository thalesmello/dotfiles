#!/usr/bin/env python3
"""Agent-inbox daemon: turn herdr's Agents panel into an inbox.

Adapted from herdr-agent-inbox (github.com/douglascorrea/herdr-agent-inbox,
MIT) with the plugin removed. Upstream ships as a herdr plugin; nothing here
needs one. Everything it does goes through the public CLI/socket API:
`pane report-metadata` and `workspace report-metadata` take a free-form
`--source` id, and `agent.view.set` is an ordinary API method -- so this is
just another script under ~/.config/herdr/scripts, started on demand like
focus-history-daemon.fish and stowed with the rest of the config. What is
lost by not installing the plugin is upstream's update path, which is the
point: no plugins.json entry, nothing to run on a new machine but `stow`.

Differences from upstream, all of them plumbing:

  * state lives in ~/.local/state/herdr/agent-inbox/ (beside focus-history/),
    not in a plugin state dir next to the session socket;
  * no config.toml of its own -- the handful of knobs are CONFIG below;
  * the actions/hooks are gone: `herdr-preset inbox-*` talks to the same
    control socket, and the daemon starts from herdr_ensure_agent_inbox.

Watches herdr's agent panes and decorates them with inbox metadata:

- pane token/metadata `title`: session title derived from the agent's native
  session transcript (first real user prompt), like ChatGPT/Claude chat titles.
- pane token `rank`: inbox tier (blocked=0, done/unread=1, working=2, idle=3,
  unknown=4, settled=5) used by an `agent.view.set` sort so the Agents panel
  behaves like an inbox: attention on top, settled slides to the bottom.
- pane tokens `age` (session running time) and `since` (time in current state).
- pane token `flag`: "⚑" settled / "●" marked unread.
- workspace tokens `agents` (per-status counts, e.g. "!1 ▸2 ✓1 ⚑1") and
  `busy` (longest currently-working stint).

Settle / mark-unread commands arrive on a control socket (see
`herdr-preset inbox-*`). State persists across herdr server restarts keyed by
terminal_id.

Stdlib only. One herdr request per connection (the server closes the socket
after each response); only events.subscribe holds a long-lived connection.
"""

import fcntl
import glob
import hashlib
import json
import os
import queue
import re
import socket
import subprocess
import sys
import threading
import time

# The metadata source id. Free-form: herdr only uses it to namespace the
# tokens a reporter owns (and to cap them), so no registration is needed.
SOURCE = "agent-inbox"
TICK_SECS = 30.0
DEBOUNCE_SECS = 0.4
TITLE_MAX = 56
STATE_KEEP_SECS = 3 * 24 * 3600  # keep state for vanished terminals 3 days
# How long a pane must be missing from agent.list before its chat is archived.
# The long wait is for panes that merely STOPPED being reported (server
# restart, detection blip); a pane herdr reported as closed uses the short one.
GONE_GRACE_SECS = 120
CLOSED_GRACE_SECS = 3
# How long a dead session's title stays available to a resumed one that takes
# its place (see _adopt_previous).
ADOPT_WINDOW_SECS = 12 * 3600

RANK_BLOCKED = "0"
RANK_ATTENTION = "1"   # done (finished, unseen) or manually marked unread
RANK_WORKING = "2"
RANK_IDLE = "3"
RANK_UNKNOWN = "4"
RANK_SETTLED = "5"

FLAG_SETTLED = "⚑"   # ⚑
FLAG_UNREAD = "●"    # ●

# Agents whose native title we can only find by working directory (herdr
# reports no session ref for them, or they never publish the title). Two live
# panes of the same such agent in one directory are indistinguishable, so we
# skip the lookup rather than risk labelling both with the same name. claude
# and pi are keyed by their own transcript and are never ambiguous.
CWD_KEYED_AGENTS = ("codex", "grok", "cursor", "hermes")

# Bump when title extraction changes so cached titles are re-derived instead
# of surviving forever in state.json. 3: titles are LLM thread summaries, so
# every prompt-derived title cached by an earlier version has to go.
TITLE_ALGO = 3

VIEW_SORT = [
    {"field": {"token": "rank"}, "order": "asc"},
    {"field": "state_change_seq", "order": "desc"},
]


def herdr_socket_path():
    p = os.environ.get("HERDR_SOCKET_PATH")
    if p:
        return p
    return os.path.expanduser("~/.config/herdr/herdr.sock")


def session_name():
    """The herdr session this daemon serves, or "" for the default one.

    The default session's socket sits directly in the herdr config dir, a
    named one under `sessions/<name>/` -- same rule herdr-preset uses.
    """
    parent = os.path.dirname(herdr_socket_path())
    if os.path.basename(os.path.dirname(parent)) == "sessions":
        return os.path.basename(parent)
    return ""


def state_dir():
    """Where state, the log and the control socket live.

    Under $XDG_STATE_HOME (beside focus-history/), NOT next to the session
    socket like upstream: this is generated, machine-local, private state, and
    ~/.config/herdr is a stow target that should stay hand-written. Suffixed
    per named session so two herdr servers get two daemons instead of one
    losing the flock race to the other.
    """
    base = os.environ.get("XDG_STATE_HOME") or os.path.expanduser("~/.local/state")
    name = session_name()
    p = os.path.join(base, "herdr", "agent-inbox" + ("@" + name if name else ""))
    os.makedirs(p, mode=0o700, exist_ok=True)
    try:
        # State holds prompt-derived titles and project paths — private.
        # makedirs won't tighten a pre-existing dir, so chmod explicitly
        # (this also gates control.sock on platforms where AF_UNIX connect
        # is governed by directory permissions).
        os.chmod(p, 0o700)
    except OSError:
        pass
    return p


# The knobs. Upstream reads these from a generated plugin config.toml that it
# hot-reloads; here they are constants, because the file they would live in is
# this one -- edit and restart (`herdr-preset inbox-restart`).
CONFIG = {
    # "first" (the opening request, like a ChatGPT/Claude chat title) or
    # "last" (the most recent request, re-derived when a turn finishes).
    "title_source": "first",
    # Prefer the name the AGENT ITSELF gives the session over a summary of
    # ours. ON, but only for the agents in native_title_agents below.
    "prefer_agent_title": True,
    # Whose native name is actually worth having:
    #
    #   pi      -- named by the session-title extension in
    #              ~/.pi/agent/extensions/, which summarizes the thread from
    #              inside pi. Better there than here: one model call per
    #              session instead of one per session per daemon restart, and
    #              the name also lands in pi's own session picker.
    #   claude  -- its own generated name (an "ai-title" transcript record).
    #   hermes / grok / cursor -- generated titles too.
    #
    # NOT codex: `threads.title` in its sqlite is the verbatim first prompt,
    # which is the thing summaries exist to avoid. Codex gets summarized here.
    "native_title_agents": ("pi", "claude", "hermes", "grok", "cursor"),
    # Fall back to a title scraped from the transcript (the first prompt,
    # truncated) when summarizing is off or has not produced anything yet.
    # OFF: that is the "copy of my first prompt" title. With it off, panes
    # show herdr's own title until their summary lands.
    "prompt_titles": False,
    # Summarize the thread with an LLM and use that as the title. ON: it is
    # the only thing that answers "what is this pane doing" in four words.
    # The digest of the conversation (thread_excerpt) arrives on stdin.
    #
    # Shape: the instruction goes in --system-prompt and the transcript is the
    # user message. Passing both as messages makes the models answer the
    # conversation instead of naming it ("Once you provide these details, I
    # can help you...").
    #
    # `pi -p` because it starts fastest here. Model: gpt-5.4 -- on this
    # gateway the cheap OpenAI tier is not deployed at all (gpt-4.1-mini,
    # gpt-5-mini, gpt-5-nano, gpt-4o-mini, o4-mini all 404 with
    # DeploymentNotFound), and `pi --list-models` offers only gpt-5.4/5.5/
    # 5.6-sol from openai. Measured on one thread: gpt-5.4 8s "Cheap Thread
    # Summaries for Dotfiles", gemini-3-flash-preview 7s (good, cheaper),
    # claude-haiku-4-5 8s (ignores the instruction and chats).
    #
    # PRIVACY: this ships excerpts of your prompts to that model on every
    # summary. Everything else in this daemon is local.
    "summarize": True,
    "summarize_cmd": (
        "pi -p --model gpt-5.4 --system-prompt "
        "'You name coding-agent sessions. Reply with ONLY a 3-7 word title, "
        "max 48 chars, no quotes, no trailing punctuation. Name the work, "
        "preferring the most recent turns over the opening request.' "
        '"$(cat)"'
    ),
    "summarize_timeout_secs": 60,
    # Least time between two summaries of the same session, so a chatty
    # thread costs one call every few minutes rather than one per turn.
    "summarize_min_interval_secs": 180,
    # Herdr's own pane title wins over ours. OFF now that titles are real
    # summaries: "π - src" says less than "Port agent-inbox into dotfiles".
    # Still the fallback whenever no summary exists yet (see _display_title).
    "prefer_terminal_title": False,
    # Overwrite herdr's pane title with ours. OFF: the sidebar reads $title
    # from our tokens, and leaving herdr's own title alone keeps pane borders,
    # `agent list` and the window title showing what the AGENT says it is.
    "set_pane_title": False,
    # Rename tabs after their agent's title. OFF: prompt_new_tab_name = true
    # means tabs here already have names that were chosen on purpose.
    "tab_rename": False,
    "tab_max_chars": 24,
    "tab_ellipsis": "…",
    "tab_respect_manual": True,
}


def load_config():
    return dict(CONFIG)


def _summary_line(out):
    """The title out of a summarizer's stdout.

    The LAST non-empty line, not the first: CLIs print banners (`pi` announces
    its gateway on startup), and the answer is what comes last. Surrounding
    quotes are stripped -- models add them however firmly you ask.
    """
    lines = [ln.strip() for ln in (out or "").splitlines() if ln.strip()]
    if not lines:
        return ""
    return lines[-1].strip().strip('"\u201c\u201d\'`').strip()


def notify(title, body=None):
    """Best-effort toast. The daemon has no terminal; this is its only voice."""
    bin_path = os.environ.get("HERDR_BIN_PATH") or "herdr"
    argv = [bin_path, "notification", "show", title,
            "--position", "top-right", "--sound", "none"]
    if body:
        argv += ["--body", body]
    try:
        subprocess.run(argv, check=False, capture_output=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        pass


def _sandbox_hint(err):
    """Explain the one failure mode that looks like a broken config.

    Meta's `pi` wrapper applies a macOS sandbox, and sandboxes do not nest:
    started from inside a sandboxed agent, this daemon's summaries all die
    with `sandbox_apply: Operation not permitted`. Started normally (from a
    keybinding, i.e. from the herdr server) they are fine -- so the fix is to
    restart the daemon from a plain shell, not to change the command.
    """
    if "sandbox_apply" in (err or ""):
        return (" [the daemon is running inside another agent's sandbox; "
                "restart it from a normal shell: agent-inbox.fish restart]")
    return ""


class Log:
    def __init__(self, path):
        self.path = path
        self._writes = 0
        self._rotate()

    def _rotate(self):
        try:
            if os.path.exists(self.path) and os.path.getsize(self.path) > 1_000_000:
                os.replace(self.path, self.path + ".1")
        except OSError:
            pass

    def __call__(self, msg):
        line = "%s %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), msg)
        self._writes += 1
        if self._writes % 500 == 0:  # long-running daemons rotate too
            self._rotate()
        try:
            with open(self.path, "a") as f:
                f.write(line)
        except OSError:
            pass


def herdr_request(method, params, timeout=10.0):
    """One request on a fresh connection; the server closes it after replying."""
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect(herdr_socket_path())
        payload = json.dumps({"id": "inbox", "method": method, "params": params})
        s.sendall((payload + "\n").encode())
        buf = b""
        while not buf.endswith(b"\n"):
            chunk = s.recv(1 << 16)
            if not chunk:
                break
            buf += chunk
    finally:
        s.close()
    # Raise RuntimeError (not ValueError) for empty/truncated responses so
    # every `except (OSError, RuntimeError)` call site survives a herdr
    # restart mid-request.
    if not buf:
        raise RuntimeError("%s: connection closed without a reply" % method)
    try:
        resp = json.loads(buf)
    except ValueError as e:
        raise RuntimeError("%s: bad response: %s" % (method, e))
    if "error" in resp:
        raise RuntimeError("%s: %s" % (method, resp["error"]))
    return resp.get("result") or {}


def fmt_dur(secs):
    secs = max(0, int(secs))
    if secs < 60:
        return "%ds" % secs
    if secs < 3600:
        return "%dm" % (secs // 60)
    if secs < 86400:
        h, m = divmod(secs // 60, 60)
        return "%dh%02dm" % (h, m) if m else "%dh" % h
    d, h = divmod(secs // 3600, 24)
    return "%dd%dh" % (d, h) if h else "%dd" % d


# ---------------------------------------------------------------- titles ----

_WS_RE = re.compile(r"\s+")
_TAGLINE_RE = re.compile(r"<[^>]{1,80}>")


def _clean_title_text(text):
    """_clean_title's scrubbing, without the length rules.

    Split out so the summarizer can be fed whole (scrubbed) turns instead of
    56-character title fragments.
    """
    if not text:
        return None
    text = re.sub(r"[\x00-\x08\x0b-\x1f\x7f-\x9f]", " ", text)
    m = re.search(r"<command-args>(.*?)</command-args>", text, re.S)
    if m and m.group(1).strip():
        text = m.group(1)
    elif re.search(r"<(command-name|local-command-stdout|local-command-caveat)>", text):
        return None
    text = re.sub(r"<system-reminder>.*?</system-reminder>", " ", text, flags=re.S)
    text = _TAGLINE_RE.sub(" ", text)
    text = re.sub(r"\(?\bhttps?://\S+\)?", " ", text)
    text = _WS_RE.sub(" ", text).strip()
    if not text or text.startswith("Caveat:"):
        return None
    return text


def _clean_title(text):
    if not text:
        return None
    # Defense in depth: drop C0/C1 control bytes (ESC, BEL, …) so terminal
    # escape sequences from transcript content or LLM output can never ride
    # a title, regardless of downstream normalization.
    text = re.sub(r"[\x00-\x08\x0b-\x1f\x7f-\x9f]", " ", text)
    m = re.search(r"<command-args>(.*?)</command-args>", text, re.S)
    if m and m.group(1).strip():
        text = m.group(1)
    elif re.search(r"<(command-name|local-command-stdout|local-command-caveat)>", text):
        # A slash-command record with no real prompt text — not title material.
        return None
    # Drop system reminders, xml-ish noise, and URLs (they make lousy titles).
    text = re.sub(r"<system-reminder>.*?</system-reminder>", " ", text, flags=re.S)
    text = _TAGLINE_RE.sub(" ", text)
    text = re.sub(r"\(?\bhttps?://\S+\)?", " ", text)
    text = _WS_RE.sub(" ", text).strip()
    if not text or text.startswith("Caveat:"):
        return None
    if len(text) < 4:
        return None
    if len(text) > TITLE_MAX:
        cut = text[:TITLE_MAX]
        if " " in cut[20:]:
            cut = cut[: cut.rfind(" ")]
        text = cut.rstrip(" ,;:.") + "…"
    return text


def _texts_from_content(content):
    out = []
    if isinstance(content, str):
        out.append(content)
    elif isinstance(content, list):
        for part in content:
            if isinstance(part, dict):
                t = part.get("text") or part.get("input_text")
                if isinstance(t, str):
                    out.append(t)
    return out


def _user_texts(obj):
    """Find user-authored text in one transcript JSON object (any agent format)."""
    if not isinstance(obj, dict):
        return []
    # claude-code: {"type":"user","message":{"role":"user","content":...}}
    # pi:          {"type":"message","message":{"role":"user","content":[...]}}
    msg = obj.get("message")
    if isinstance(msg, dict) and msg.get("role") == "user":
        if obj.get("isSidechain"):
            return []
        return _texts_from_content(msg.get("content"))
    # codex rollouts: {"type":"response_item","payload":{"role":"user","content":[...]}}
    payload = obj.get("payload")
    if isinstance(payload, dict) and payload.get("role") == "user":
        return _texts_from_content(payload.get("content"))
    if obj.get("role") == "user":
        return _texts_from_content(obj.get("content"))
    return []


def thread_excerpt(path, max_chars=3000, keep_first=2, keep_last=4):
    """A digest of the whole conversation, for the summarizer.

    Titles used to come from the FIRST user prompt alone, which is why they
    read like a copy of it. A thread is better described by where it started
    plus where it got to, so this keeps the opening prompts and the most
    recent ones and drops the middle (the marker tells the model that the
    thread is longer than what it sees).

    User turns only: assistant output is long, and the transcript formats
    differ per agent, while `_user_texts` already normalizes user content
    across claude / pi / codex.
    """
    texts = []
    for line in _tail_lines(path, max_bytes=1024 * 1024):
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except ValueError:
            continue
        for text in _user_texts(obj):
            if "<system-reminder>" in text and "</system-reminder>" not in text:
                continue
            # Same scrubbing the titles get (control bytes, slash-command
            # wrappers, reminders, URLs), then a per-turn cap so one pasted
            # file cannot crowd out the rest of the thread.
            clean = _clean_title_text(text)
            if clean:
                texts.append(clean[:600])
    if not texts:
        return None
    if len(texts) > keep_first + keep_last:
        parts = texts[:keep_first] + ["[…]"] + texts[-keep_last:]
    else:
        parts = texts
    out = "\n\n".join(parts)
    return out[:max_chars]


def _scan_lines_for_prompt(lines, want_last):
    """Returns (clean_title, raw_text). For want_last, feed reversed lines."""
    summary = None
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except ValueError:
            continue
        if isinstance(obj, dict) and obj.get("type") == "summary" and obj.get("summary"):
            summary = summary or _clean_title(str(obj["summary"]))
            continue
        for text in _user_texts(obj):
            if "<system-reminder>" in text and "</system-reminder>" not in text:
                continue
            title = _clean_title(text)
            if title:
                raw = _raw_prompt(text)
                return (title if want_last else (summary or title)), raw
    return summary, None


def _raw_prompt(text):
    """The prompt as summarizer input: unwrapped but untruncated."""
    m = re.search(r"<command-args>(.*?)</command-args>", text, re.S)
    if m and m.group(1).strip():
        text = m.group(1)
    text = re.sub(r"<system-reminder>.*?</system-reminder>", " ", text, flags=re.S)
    text = _WS_RE.sub(" ", text).strip()
    return text[:4000]


def _tail_lines(path, max_bytes=512 * 1024):
    size = os.path.getsize(path)
    with open(path, "rb") as f:
        f.seek(max(0, size - max_bytes))
        data = f.read()
    lines = data.split(b"\n")
    if size > max_bytes and lines:
        lines = lines[1:]  # drop the partial first line
    return [ln.decode("utf-8", "replace") for ln in lines]


def _newest_json_title(candidates, keys, mtime_of=None):
    """(title, mtime) from the most recently touched candidate JSON file.

    candidates: iterable of file paths; keys: field names to try in order;
    mtime_of: optional callable(dict) -> sortable recency from file content.
    """
    best = None
    for path in candidates:
        try:
            stamp = os.path.getmtime(path)
            with open(path) as f:
                data = json.load(f)
        except (OSError, ValueError):
            continue
        if not isinstance(data, dict):
            continue
        if mtime_of:
            stamp = mtime_of(data) or stamp
        title = None
        for key in keys:
            title = _clean_title(str(data.get(key) or ""))
            if title:
                break
        if title and (best is None or stamp > best[1]):
            best = (title, stamp)
    return best or (None, 0)


def codex_native_title(cwd):
    """codex keeps a per-thread `title` in ~/.codex/state_5.sqlite.

    It is the verbatim first prompt rather than a short generated name, so it
    gets truncated like any prompt-derived title — but it is authoritative,
    already indexed by cwd, and works for panes with no session ref at all.
    """
    if not cwd:
        return None
    db = os.path.expanduser("~/.codex/state_5.sqlite")
    if not os.path.exists(db):
        return None
    try:
        import sqlite3
        # Read-only URI so a live codex never blocks us and we never write.
        con = sqlite3.connect("file:%s?mode=ro" % db, uri=True, timeout=0.5)
        try:
            con.execute("PRAGMA query_only = 1")
            row = con.execute(
                "SELECT title, preview, first_user_message FROM threads "
                "WHERE cwd = ? AND archived = 0 "
                "ORDER BY COALESCE(updated_at_ms, 0) DESC LIMIT 1",
                (cwd,),
            ).fetchone()
        finally:
            con.close()
    except Exception:
        return None
    for value in row or ():
        title = _clean_title(str(value or ""))
        if title:
            return title
    return None


def _sqlite_scalar(db, sql, params):
    """One read-only scalar query; never blocks or writes the agent's db."""
    if not os.path.exists(db):
        return None
    try:
        import sqlite3
        con = sqlite3.connect("file:%s?mode=ro" % db, uri=True, timeout=0.5)
        try:
            con.execute("PRAGMA query_only = 1")
            row = con.execute(sql, params).fetchone()
        finally:
            con.close()
    except Exception:
        return None
    return row


def hermes_native_title(cwd):
    """hermes auto-titles sessions into ~/.hermes/profiles/<p>/state.db
    (`sessions.title`, best-effort and only set while NULL). It reports a
    session id + lifecycle state to herdr but never the title, so match on
    cwd across profiles, preferring a session that is still running."""
    if not cwd:
        return None
    best = None
    for db in glob.glob(os.path.expanduser("~/.hermes/profiles/*/state.db")):
        row = _sqlite_scalar(
            db,
            "SELECT title, ended_at IS NULL AS live, COALESCE(started_at, '') "
            "FROM sessions WHERE cwd = ? AND COALESCE(archived, 0) = 0 "
            "AND title IS NOT NULL AND title != '' "
            "ORDER BY live DESC, started_at DESC LIMIT 1",
            (cwd,),
        )
        if not row:
            continue
        title = _clean_title(str(row[0] or ""))
        if title:
            rank = (row[1] or 0, row[2] or "")
            if best is None or rank > best[1]:
                best = (title, rank)
    return best[0] if best else None


def grok_native_title(cwd):
    """grok stores `generated_title` per session under a url-encoded cwd dir."""
    if not cwd:
        return None
    import urllib.parse
    root = os.path.expanduser(
        "~/.grok/sessions/%s" % urllib.parse.quote(cwd, safe="")
    )
    return _newest_json_title(
        glob.glob(os.path.join(root, "*", "summary.json")),
        ("generated_title", "session_summary"),
    )[0]


def cursor_native_title(cwd):
    """cursor-agent stores `title` per chat under md5(cwd)/<chat-uuid>/."""
    if not cwd:
        return None
    digest = hashlib.md5(cwd.encode()).hexdigest()
    root = os.path.expanduser("~/.cursor/chats/%s" % digest)
    return _newest_json_title(
        glob.glob(os.path.join(root, "*", "meta.json")),
        ("title",),
        mtime_of=lambda d: (d.get("updatedAtMs") or 0) / 1000.0 or None,
    )[0]


def pi_native_title(path):
    """pi never auto-generates a title, but a name the user sets (`/name`,
    `--name`, picker rename, RPC set_session_name) is appended to the same
    transcript as {"type":"session_info","name":...}; the latest one wins and
    an empty name clears it — matching what pi's own resume picker shows."""
    if not path:
        return None
    try:
        size = os.path.getsize(path)
        cap = 256 * 1024
        while True:
            for line in reversed(_tail_lines(path, cap)):
                if '"session_info"' not in line:
                    continue
                try:
                    obj = json.loads(line)
                except ValueError:
                    continue
                if obj.get("type") == "session_info" and "name" in obj:
                    # An empty name is pi's way of clearing it.
                    return _clean_title(str(obj.get("name") or "")) or None
            if cap >= min(size, 32 * 1024 * 1024):
                return None
            cap *= 4
    except OSError:
        return None


def native_title_from_transcript(path):
    """claude-code's own name for the session, if it has one.

    Two record types, both kept current as the conversation evolves:
      {"type":"custom-title","customTitle":...}  a name YOU set (/title)
      {"type":"ai-title","aiTitle":...}          claude's generated title
    A custom title wins — it is an explicit choice — so scan from the end and
    take the newest of each, preferring custom. This mirrors what claude's
    own resume picker displays.
    """
    try:
        size = os.path.getsize(path)
        cap = 256 * 1024
        while True:
            ai = None
            for line in reversed(_tail_lines(path, cap)):
                if '"customTitle"' not in line and '"aiTitle"' not in line:
                    continue
                try:
                    obj = json.loads(line)
                except ValueError:
                    continue
                kind = obj.get("type")
                if kind == "custom-title":
                    title = _clean_title(str(obj.get("customTitle") or ""))
                    if title:
                        return title  # explicit name beats the generated one
                elif kind == "ai-title" and ai is None:
                    ai = _clean_title(str(obj.get("aiTitle") or ""))
            if ai:
                return ai
            if cap >= min(size, 32 * 1024 * 1024):
                return None
            cap *= 4
    except OSError:
        return None


def native_title_for(rec, path):
    """The session name the AGENT ITSELF gives this conversation, or None.

    Where each agent keeps it (verified 2026-07-28):
      claude       transcript records {"type":"ai-title","aiTitle":...}   ✅
      grok         ~/.grok/sessions/<urlencoded cwd>/<id>/summary.json
                   -> generated_title                                    ✅
      cursor       ~/.cursor/chats/<md5 cwd>/<uuid>/meta.json -> title   ✅
      codex        ~/.codex/state_5.sqlite threads.title — the verbatim
                   first prompt, used as-is (truncated)                  ✅
      pi           no auto-title, but a user-set name lands in the same
                   transcript as {"type":"session_info","name":...}      ✅
      hermes       auto-titles into ~/.hermes/profiles/*/state.db
                   sessions.title (reports its id to herdr, never the
                   title), so read the db directly                       ✅

    codex, grok, cursor and hermes are keyed by cwd (herdr gets no session
    ref for the first three, and hermes never reports its title), so the
    newest session for that directory wins.
    """
    agent = rec.get("agent")
    if agent == "claude" and path:
        return native_title_from_transcript(path)
    if agent == "codex":
        return codex_native_title(rec.get("cwd"))
    if agent == "pi" and path:
        return pi_native_title(path)
    if agent == "hermes":
        return hermes_native_title(rec.get("cwd"))
    if agent == "grok":
        return grok_native_title(rec.get("cwd"))
    if agent == "cursor":
        return cursor_native_title(rec.get("cwd"))
    return None


def title_from_transcript(path, source="first", prefer_native=True):
    """(clean_title, raw_prompt) from a session transcript.

    A native agent title wins when present (raw is None so it is never sent
    to the summarizer — the agent already named it).
    source "first": the opening user prompt (preferring claude summary lines).
    source "last":  the most recent user prompt (tail-scanned).
    """
    if prefer_native:
        native = native_title_from_transcript(path)
        if native:
            return native, None
    try:
        if source == "last":
            # Transcript lines can be huge (base64 images in tool results), so
            # widen the tail window until a user prompt shows up — but cap the
            # read so a promptless multi-hundred-MB transcript can't be
            # re-slurped whole on every tick.
            size = os.path.getsize(path)
            cap = 512 * 1024
            while True:
                title, raw = _scan_lines_for_prompt(
                    reversed(_tail_lines(path, cap)), True)
                if title or cap >= min(size, 32 * 1024 * 1024):
                    return title, raw
                cap *= 4
        with open(path, "r", errors="replace") as f:
            head = []
            for i, line in enumerate(f):
                if i > 400:
                    break
                head.append(line)
        return _scan_lines_for_prompt(head, False)
    except OSError:
        return None, None


def _munge_claude_cwd(cwd):
    return re.sub(r"[/.]", "-", cwd)


def _pi_munged_cwd(cwd):
    """pi's directory name for a cwd: /Users/me/src -> --Users-me-src--"""
    return "--%s--" % (cwd or "").strip("/").replace("/", "-")


def pi_session_for_cwd(cwd):
    """Newest pi transcript for a directory, when herdr reports no ref.

    `pi --session <file>` (or a resume from pi's own picker) started outside
    herdr's integration leaves the pane with no session ref, so there is no
    transcript to summarize and the row falls back to the terminal title.

    Two lookups, cheapest first: pi's own per-cwd directory, then a scan of
    the newest transcripts anywhere, matching the `cwd` in each one's opening
    `session` record -- pi also files sessions under profile directories
    (e.g. sessions/devmate/), where the directory name says nothing about the
    working directory.
    """
    if not cwd:
        return None
    root = os.path.expanduser("~/.pi/agent/sessions")
    if not os.path.isdir(root):
        return None

    def newest(paths):
        best, best_mtime = None, -1
        for p in paths:
            try:
                m = os.path.getmtime(p)
            except OSError:
                continue
            if m > best_mtime:
                best, best_mtime = p, m
        return best

    hit = newest(glob.glob(os.path.join(root, _pi_munged_cwd(cwd), "*.jsonl")))
    if hit:
        return hit

    candidates = glob.glob(os.path.join(root, "*", "*.jsonl"))
    try:
        candidates.sort(key=os.path.getmtime, reverse=True)
    except OSError:
        return None
    for path in candidates[:40]:   # newest only; older ones are not "this pane"
        try:
            with open(path) as f:
                head = f.readline()
            obj = json.loads(head)
        except (OSError, ValueError):
            continue
        if isinstance(obj, dict) and obj.get("type") in ("session", "session_info") \
                and obj.get("cwd") == cwd:
            return path
    return None


def codex_rollout_for_cwd(cwd):
    """Newest codex rollout transcript for a directory, from codex's own index.

    herdr gets no session ref for a codex pane that was resumed by hand, so
    without this there is no transcript to summarize and the row falls back to
    the terminal title. `threads.rollout_path` in ~/.codex/state_5.sqlite is
    codex's own answer to "which file is this conversation".
    """
    if not cwd:
        return None
    db = os.path.expanduser("~/.codex/state_5.sqlite")
    if not os.path.exists(db):
        return None
    try:
        import sqlite3
        con = sqlite3.connect("file:%s?mode=ro" % db, uri=True, timeout=0.5)
        try:
            con.execute("PRAGMA query_only = 1")
            row = con.execute(
                "SELECT rollout_path FROM threads WHERE cwd = ? AND archived = 0 "
                "ORDER BY COALESCE(updated_at_ms, 0) DESC LIMIT 1",
                (cwd,),
            ).fetchone()
        finally:
            con.close()
    except Exception:
        return None
    path = (row or [None])[0]
    return path if path and os.path.exists(path) else None


def resolve_transcript(agent_rec, cwd_fallback=False):
    """Locate the native session transcript for an agent pane, if any.

    cwd_fallback allows the by-directory lookups, which are only safe when the
    caller has checked that this (agent, cwd) pair has a single live pane --
    two codex panes in one directory are indistinguishable that way.
    """
    sess = agent_rec.get("agent_session")
    if not isinstance(sess, dict):
        sess = {}
    kind, value = sess.get("kind"), sess.get("value")
    if not value:
        if cwd_fallback:
            agent = agent_rec.get("agent")
            if agent == "codex":
                return codex_rollout_for_cwd(agent_rec.get("cwd"))
            if agent == "pi":
                return pi_session_for_cwd(agent_rec.get("cwd"))
        return None
    if kind == "path":
        return value if os.path.exists(value) else None
    # A session *id* gets interpolated into paths/globs below — reject
    # anything that could traverse or glob outside the intended directories.
    if re.search(r"[/\\*?\[\]]|\.\.", value):
        return None
    if kind == "id":
        agent = agent_rec.get("agent")
        if agent == "claude":
            cwd = agent_rec.get("cwd") or ""
            p = os.path.expanduser(
                "~/.claude/projects/%s/%s.jsonl" % (_munge_claude_cwd(cwd), value)
            )
            if os.path.exists(p):
                return p
            hits = glob.glob(os.path.expanduser("~/.claude/projects/*/%s.jsonl" % value))
            return hits[0] if hits else None
        if agent == "codex":
            hits = glob.glob(
                os.path.expanduser("~/.codex/sessions/**/*%s*.jsonl" % value),
                recursive=True,
            )
            return hits[0] if hits else None
    return None


# ---------------------------------------------------------------- daemon ----


class InboxDaemon:
    def __init__(self):
        self.dir = state_dir()
        self.log = Log(os.path.join(self.dir, "daemon.log"))
        self.state_path = os.path.join(self.dir, "state.json")
        self.control_path = os.path.join(self.dir, "control.sock")
        self.lock = threading.RLock()
        self.dirty = threading.Event()
        self.stop = threading.Event()
        self.terminals = {}       # terminal_id -> persisted per-agent state
        self.last_report = {}     # terminal_id -> {"title":..., "tokens": {...}}
        self.ws_report = {}       # workspace_id -> tokens dict last reported
        self.pane_to_tid = {}     # pane_id -> terminal_id (from last refresh)
        self.cfg = load_config()
        self.cfg_mtime = self._cfg_mtime()
        self.ambiguous = set()    # (agent, cwd) pairs with >1 live pane
        self.tab_labels = {}      # tab_id -> label WE set (never clobber yours)
        self.sum_q = queue.Queue()
        self.sum_inflight = set()  # (tid, hash) queued or running
        self.sum_failed = set()    # hashes that failed this run; don't retry
        self.closed_panes = set()  # panes herdr reported closed (see _prune)
        # Set when summarizing cannot work in this process at all (sandbox);
        # stops the queue from retrying every few minutes forever.
        self.summarize_broken = False
        self._load()

    # -- persistence --

    def _load(self):
        try:
            with open(self.state_path) as f:
                data = json.load(f)
            self.terminals = data.get("terminals", {})
            self.tab_labels = data.get("tab_labels", {}) or {}
        except (OSError, ValueError):
            self.terminals = {}

    def _save(self):
        tmp = self.state_path + ".tmp"
        try:
            with open(tmp, "w") as f:
                json.dump({"terminals": self.terminals,
                           "tab_labels": self.tab_labels}, f)
            os.replace(tmp, self.state_path)
        except OSError as e:
            self.log("state save failed: %s" % e)

    # -- inbox model --

    @staticmethod
    def rank_for(status, settled, unread):
        # `settled` outranks `done`: settling is an explicit "I'm finished with
        # this thread". Fresh activity clears it (working/blocked transition),
        # so anything genuinely new still surfaces.
        if status == "blocked":
            return RANK_BLOCKED
        if unread:
            return RANK_ATTENTION
        if status == "working":
            return RANK_WORKING
        if settled:
            return RANK_SETTLED
        if status == "done":
            return RANK_ATTENTION
        if status == "idle":
            return RANK_IDLE
        return RANK_UNKNOWN

    def assert_view(self):
        try:
            herdr_request(
                "agent.view.set",
                {"source": SOURCE, "label": "Inbox", "sort": VIEW_SORT},
            )
            self.log("agent view asserted")
        except (OSError, RuntimeError) as e:
            self.log("agent.view.set failed: %s" % e)

    def _cfg_mtime(self):
        # CONFIG lives in this file, so "the config changed" means this script
        # was edited -- which only takes effect on restart anyway. Kept as a
        # stub so the refresh loop below reads the same as upstream's.
        return 0

    def _maybe_reload_config(self):
        return

    def _archive_chat(self, st, now):
        """Archive st's current chat: into its in-pane history (capped 10,
        drives the tree's ⚫ rows) and the durable history.jsonl (drives the
        ChatGPT-style history browser, resumable via stored session refs)."""
        hist = list(st.get("history") or [])
        # Whatever the sidebar was calling this chat: the derived title when we
        # have one, else herdr's own terminal title (recorded every refresh).
        # Without the fallback, an agent with no readable transcript -- or any
        # agent at all while prefer_terminal_title is on and no transcript was
        # ever found -- would vanish on close instead of landing in history.
        title = st.get("title") or st.get("term_title")
        # A pane archived on "gone" that reappears and closes for real would
        # archive the same chat twice — skip unchanged re-archives.
        fingerprint = (st.get("sess_ref"), title)
        if fingerprint == tuple(st.get("_last_archived") or ()):
            return hist
        if title:
            st["_last_archived"] = list(fingerprint)
            entry = {
                "agent": st.get("agent"),
                "title": title,
                "closed": now,
                "first_seen": st.get("first_seen"),
                "workspace_id": st.get("ws"),
                "workspace": st.get("ws_label"),
                "pane_id": st.get("pane_id"),
                "cwd": st.get("cwd"),
                "sess_kind": st.get("sess_kind"),
                "sess_value": st.get("sess_value"),
            }
            hist.append({"agent": entry["agent"], "title": title,
                         "closed": now})
            self._append_history(entry)
        return hist[-10:]

    def _append_history(self, entry):
        path = os.path.join(self.dir, "history.jsonl")
        try:
            if os.path.exists(path) and os.path.getsize(path) > 400_000:
                with open(path) as f:
                    tail = f.readlines()[-1000:]
                tmp = path + ".tmp"
                with open(tmp, "w") as f:
                    f.writelines(tail)
                os.replace(tmp, path)  # atomic — readers never see a partial file
            with open(path, "a") as f:
                f.write(json.dumps(entry) + "\n")
        except OSError as e:
            self.log("history append failed: %s" % e)

    def _ensure_title(self, rec, st, now):
        """Generate/refresh the session title for one agent record."""
        sess = rec.get("agent_session") or {}
        sess_ref = "%s:%s" % (sess.get("kind"), sess.get("value"))
        if sess.get("value") and st.get("sess_ref") not in (None, sess_ref):
            # The pane started a NEW native session — archive the old chat.
            st["history"] = self._archive_chat(st, now)
        if sess.get("value"):
            st["sess_ref"] = sess_ref
            st["sess_kind"] = sess.get("kind")
            st["sess_value"] = sess.get("value")
        # Every knob that changes what a title IS belongs in this key: when it
        # changes the cached title is not "fresh" any more and gets re-derived
        # instead of lingering in state.json from a previous configuration.
        sess_key = "%s:%s:%s:%s:%s:%s:%s:%s" % (sess.get("kind"), sess.get("value"),
                                                self.cfg["title_source"],
                                                self.cfg["prefer_agent_title"],
                                                ",".join(self.cfg["native_title_agents"]),
                                                self.cfg["prompt_titles"],
                                                self.cfg["summarize"],
                                                TITLE_ALGO)
        fresh = st.get("title_sess") == sess_key
        if st.get("title_manual") and st.get("title"):
            if fresh:
                return
            st["title_manual"] = False  # new session ref supersedes manual title
        # The cwd fallback needs the ambiguity guard: it finds the newest
        # conversation for a directory, which is the wrong answer when two
        # panes of the same agent sit in one.
        cwd_ok = (rec.get("agent"), rec.get("cwd")) not in self.ambiguous
        path = resolve_transcript(rec, cwd_fallback=cwd_ok)

        # The agent's own name for the session is checked EVERY tick, before
        # any cached-title shortcut: an agent renames its session as work
        # evolves, and a session can gain a name long after it started.
        # The ambiguity guard applies ONLY to cwd-keyed agents — claude and pi
        # are looked up by their own transcript, so several of them in one
        # directory are fine.
        cwd_keyed = rec.get("agent") in CWD_KEYED_AGENTS
        if self.cfg["prefer_agent_title"] \
                and rec.get("agent") in self.cfg["native_title_agents"] \
                and not (cwd_keyed
                         and (rec.get("agent"), rec.get("cwd")) in self.ambiguous):
            native = native_title_for(rec, path)
            if native:
                st["title_sess"] = sess_key
                st["title_native"] = True
                st["title_stale"] = False
                if native != st.get("title"):
                    st["title"] = native
                    self.log("title (agent) %s -> %r" % (rec.get("pane_id"), native))
                return
            if st.get("title_native"):
                # The agent's title went away (cleared) — re-derive our own.
                st["title_native"] = False
                st["title"] = None

        if self.cfg["summarize"] and self.cfg["summarize_cmd"] and path:
            if not fresh:
                # A new conversation, or a title made under different rules.
                # An INHERITED title is the exception: it belongs to the
                # conversation this pane just resumed, so it stands in until
                # the summarizer speaks (see _adopt_previous).
                if st.pop("title_adopted", False):
                    st["sum_hash"] = None
                    st["sum_at"] = 0
                else:
                    st["title"] = None
                    st["sum_hash"] = None
                    st["sum_at"] = 0
            st["title_sess"] = sess_key
            st["title_stale"] = False
            self._queue_summary(rec, st, path, now)
            return

        if not self.cfg["prompt_titles"]:
            # No agent-provided name and we don't invent one: leave the title
            # empty so _display_title falls back to herdr's own.
            st["title_sess"] = sess_key
            st["title_stale"] = False
            return

        if st.get("title") and fresh and not st.get("title_stale"):
            return
        # Retry transcripts at most once per tick; they appear shortly after
        # the first prompt is sent.
        if st.get("title_tried", 0) > now - (TICK_SECS - 1) and fresh and not st.get("title_stale"):
            return
        st["title_tried"] = now
        if not fresh:
            st["title_sess"] = sess_key
            st["title"] = None
            st["sum_hash"] = None
        st["title_stale"] = False
        if not path:
            if not st.get("title"):
                st["title"] = None
            return
        # Native titles were already handled above; derive from prompts only.
        title, raw = title_from_transcript(path, self.cfg["title_source"],
                                           prefer_native=False)
        if not title:
            return
        summarize = bool(self.cfg["summarize"] and self.cfg["summarize_cmd"] and raw)
        if not summarize:
            if title != st.get("title"):
                st["title"] = title
                self.log("title %s -> %r" % (rec.get("pane_id"), title))
            return
        h = hashlib.sha1(raw.encode()).hexdigest()[:12]
        if st.get("sum_hash") == h and st.get("title"):
            return  # already summarized this content
        if not st.get("title"):
            st["title"] = title  # heuristic placeholder until the summary lands
        tid = rec.get("terminal_id")
        if h in self.sum_failed or (tid, h) in self.sum_inflight:
            return
        self.sum_inflight.add((tid, h))
        self.sum_q.put((tid, h, rec.get("agent"), rec.get("cwd"), raw))

    def _queue_summary(self, rec, st, path, now):
        """Queue an LLM summary of this thread, if it is worth one now.

        Three gates, in order of cheapness: the digest must have CHANGED
        (hash), the previous summary must be older than
        summarize_min_interval_secs, and the same digest must not already be
        queued, running, or known to fail. The title itself is left alone
        until a summary lands -- no placeholder -- so the row shows herdr's
        own title rather than a first-prompt copy that then changes.
        """
        excerpt = thread_excerpt(path)
        if not excerpt or self.summarize_broken:
            return
        h = hashlib.sha1(excerpt.encode()).hexdigest()[:12]
        if st.get("sum_hash") == h and st.get("title"):
            return
        if h in self.sum_failed or (rec.get("terminal_id"), h) in self.sum_inflight:
            return
        interval = self.cfg["summarize_min_interval_secs"]
        if st.get("title") and now - st.get("sum_at", 0) < interval:
            return
        tid = rec.get("terminal_id")
        self.sum_inflight.add((tid, h))
        self.sum_q.put((tid, h, rec.get("agent"), rec.get("cwd"), excerpt))

    def summarize_loop(self):
        env = dict(os.environ)
        env["PATH"] = env.get("PATH", "") + ":/opt/homebrew/bin:/usr/local/bin"
        while not self.stop.is_set():
            try:
                tid, h, agent, cwd, raw = self.sum_q.get(timeout=1.0)
            except queue.Empty:
                continue
            payload = "Agent: %s\nWorkdir: %s\n\nConversation:\n%s" % (agent, cwd, raw)
            title = None
            try:
                r = subprocess.run(
                    self.cfg["summarize_cmd"], shell=True, env=env,
                    input=payload, capture_output=True, text=True,
                    timeout=self.cfg["summarize_timeout_secs"],
                )
                if r.returncode == 0:
                    title = _clean_title(_summary_line(r.stdout))
                else:
                    err = r.stderr or r.stdout or ""
                    self.log("summarize_cmd rc=%d: %s%s" % (
                        r.returncode, err[:200], _sandbox_hint(err)))
                    if "sandbox_apply" in err:
                        # Not a transient failure: this daemon inherited a
                        # sandbox at startup and every future call will die the
                        # same way. Stop trying (one log line beats hundreds)
                        # and say so where it will actually be seen.
                        self.summarize_broken = True
                        notify("agent inbox: summaries disabled",
                               "daemon is inside another agent's sandbox — "
                               "run: agent-inbox.fish restart")
            except (OSError, subprocess.TimeoutExpired) as e:
                self.log("summarize failed: %s" % e)
            with self.lock:
                self.sum_inflight.discard((tid, h))
                st = self.terminals.get(tid)
                if title and st:
                    st["title"] = title
                    st["sum_hash"] = h
                    st["sum_at"] = time.time()
                    self.log("summary %s -> %r" % (tid, title))
                    self.dirty.set()
                elif not title:
                    self.sum_failed.add(h)

    def refresh(self):
        now = time.time()
        self._maybe_reload_config()
        try:
            agents = herdr_request("agent.list", {}).get("agents", [])
        except (OSError, RuntimeError, ValueError) as e:
            self.log("agent.list failed: %s" % e)
            return
        ws_labels = {}
        try:
            for wsr in herdr_request("workspace.list", {}).get("workspaces", []):
                ws_labels[wsr.get("workspace_id")] = wsr.get("label")
        except (OSError, RuntimeError, ValueError):
            pass
        pending = []
        ws_pending = []
        tab_best = {}
        seen_pairs = {}
        for rec in agents:
            key = (rec.get("agent"), rec.get("cwd"))
            seen_pairs[key] = seen_pairs.get(key, 0) + 1
        self.ambiguous = {k for k, n in seen_pairs.items() if n > 1}
        with self.lock:
            self.pane_to_tid = {}
            seen_tids = set()
            ws_agents = {}
            for rec in agents:
                tid = rec.get("terminal_id")
                pane_id = rec.get("pane_id")
                if not tid or not pane_id:
                    continue
                seen_tids.add(tid)
                self.pane_to_tid[pane_id] = tid
                st = self.terminals.get(tid)
                if st is None or st.get("agent") != rec.get("agent"):
                    old = st
                    st = {
                        "agent": rec.get("agent"),
                        "first_seen": now,
                        "last_status": rec.get("agent_status"),
                        "last_change": now,
                        "settled": False,
                        "unread": False,
                        "flagged_at": 0,
                        "title": None,
                        "title_sess": None,
                        "title_tried": 0,
                    }
                    if old:
                        st["history"] = self._archive_chat(old, now)
                    else:
                        self._adopt_previous(rec, st, tid, now)
                    self.terminals[tid] = st
                elif not st.get("title") and not st.get("adopt_tried"):
                    # Also for records that already exist but never got a
                    # title -- a pane resumed while the daemon was down comes
                    # back this way, and the restart is what discovers it.
                    self._adopt_previous(rec, st, tid, now)
                status = rec.get("agent_status") or "unknown"
                if status != st.get("last_status"):
                    st["last_change"] = now
                    st["last_status"] = status
                    if status in ("working", "blocked"):
                        # New activity reopens the item, Theo-style.
                        st["settled"] = False
                        st["unread"] = False
                    elif self.cfg["title_source"] == "last" or self.cfg["summarize"]:
                        # Turn ended — the thread moved on, so its title may
                        # be out of date (rate-limited in _queue_summary).
                        st["title_stale"] = True
                        st["title_tried"] = 0
                st["gone_since"] = None
                st["gone_archived"] = False
                st["ws"] = rec.get("workspace_id")
                st["ws_label"] = ws_labels.get(rec.get("workspace_id"))
                st["pane_id"] = pane_id
                st["cwd"] = rec.get("cwd")
                # Kept for _archive_chat: once the pane is gone the record is
                # all that is left, and herdr's title is not in it otherwise.
                st["term_title"] = (rec.get("label")
                                    or rec.get("terminal_title_stripped")
                                    or rec.get("terminal_title"))
                self._ensure_title(rec, st, now)

                title = self._display_title(rec, st)
                rank = self.rank_for(status, st["settled"], st["unread"])
                flag = FLAG_SETTLED if st["settled"] else (FLAG_UNREAD if st["unread"] else "")
                tokens = {
                    "title": title,
                    "rank": rank,
                    "age": fmt_dur(now - st["first_seen"]),
                    "since": fmt_dur(now - st["last_change"]),
                    "flag": flag,
                }
                pending.append(self._pane_report_item(pane_id, tid, st, tokens))

                # Per tab, the most attention-worthy agent names the tab
                # (rank asc, then most recent state change) — stable when a
                # tab holds several agents.
                tab_id = rec.get("tab_id")
                if tab_id and st.get("title"):
                    key = (rank, -(rec.get("state_change_seq") or 0))
                    prev = tab_best.get(tab_id)
                    if prev is None or key < prev[0]:
                        tab_best[tab_id] = (key, st["title"])

                ws = rec.get("workspace_id")
                if ws:
                    ws_agents.setdefault(ws, []).append((status, st, now))

            ws_pending = self._workspace_report_items(ws_agents)
            self._prune(seen_tids, now)
            self._save()
        # Socket round-trips happen OUTSIDE the lock so control commands
        # (settle/unread/…) never queue behind a slow herdr server.
        for item in pending:
            if item:
                self._send_pane_report(*item)
        for ws, tokens in ws_pending:
            self._send_ws_report(ws, tokens)
        if self.cfg["tab_rename"]:
            titles = {t: v[1] for t, v in tab_best.items()}
            for tab_id, label in self._tab_rename_items(titles):
                self._send_tab_rename(tab_id, label)

    def _adopt_previous(self, rec, st, tid, now):
        """Inherit the title of the conversation this pane just resumed.

        State is keyed by terminal_id, which survives a herdr restart but NOT
        the agent process: resume a dead session (prefix+ctrl+r, or reopening
        a chat from the inbox) and the agent comes back on a fresh terminal
        with an empty record, so the title -- including one you typed -- was
        lost. herdr reports no session ref for such a pane either, so there is
        often nothing left to re-derive it from.

        The match is the same shape `herdr-preset resume-agent` uses: the most
        recently active DEAD record for this (agent, cwd), preferring one
        whose session ref equals this pane's, within ADOPT_WINDOW_SECS. Each
        record is adopted once, so two panes cannot claim the same chat.

        Only the title is inherited. Settle/unread are not: the conversation
        is active again, which is exactly when the inbox should show it.
        """
        st["adopt_tried"] = True
        sess = rec.get("agent_session") or {}
        ref = "%s:%s" % (sess.get("kind"), sess.get("value")) if sess.get("value") else None
        best = None
        for other_tid, old in self.terminals.items():
            if other_tid == tid or old.get("adopted_by"):
                continue
            if not old.get("title") or not old.get("gone_since"):
                continue
            if old.get("agent") != rec.get("agent") or old.get("cwd") != rec.get("cwd"):
                continue
            if now - old["gone_since"] > ADOPT_WINDOW_SECS:
                continue
            score = (1 if ref and old.get("sess_ref") == ref else 0,
                     old.get("last_change") or 0)
            if best is None or score > best[0]:
                best = (score, other_tid, old)
        if not best:
            return
        _, other_tid, old = best
        old["adopted_by"] = tid
        st["title"] = old["title"]
        st["title_manual"] = old.get("title_manual")
        st["title_adopted"] = True
        st["first_seen"] = old.get("first_seen", now)  # same conversation, same age
        self.log("adopted title from %s -> %s: %r"
                 % (other_tid, tid, old["title"]))

    def _display_title(self, rec, st):
        """What the $title token shows for one agent record.

        Derived title first, then whatever herdr itself knows -- the agent's
        reported label, then the pane's terminal title. That fallback is the
        whole reason the sidebar can drop `terminal_title_stripped` as a row:
        an agent with no transcript to read (hermes, an agent whose
        integration isn't installed, any agent before its first prompt lands,
        a claude session whose transcript hasn't been flushed yet) must still
        read at least as well as it did before the inbox existed, not collapse
        to the bare program name.

        terminal_title_stripped, not terminal_title: herdr strips the agents'
        own decorations (spinners, activity marks) there. No feedback loop
        either -- report_metadata overwrites herdr's `title` field for the
        pane, but never terminal_title*, which stay the agent's own.
        """
        herdr_title = rec.get("label") or rec.get("terminal_title_stripped") \
            or rec.get("terminal_title")
        if self.cfg["prefer_terminal_title"] and herdr_title:
            return herdr_title
        return st.get("title") or herdr_title or st.get("agent") or "agent"

    # Reference for the row in config.toml -- the full chain $title resolves,
    # with the shipped settings (prefer_terminal_title on, prompt_titles off):
    #
    #   1. herdr's terminal_title_stripped -- what the sidebar showed before
    #      this daemon existed ("π - src");
    #   2. the agent's own session name, for agents herdr gets no title from:
    #      codex's thread title, claude's generated name, a pi session you
    #      named, hermes/grok/cursor's generated titles;
    #   3. the agent's name.
    #
    # So no agent row is ever emptier than it used to be, and codex -- which
    # sets no terminal title at all -- gets its own name for the thread
    # instead of nothing.

    def _pane_report_item(self, pane_id, tid, st, tokens):
        # Only override the pane title if we generated one AND ours is the one
        # meant to be shown: with prefer_terminal_title the derived title is
        # not what the sidebar wants, and reporting it would replace herdr's
        # `title` for the pane everywhere else too (agent list, pane borders).
        meta_title = st.get("title") if self.cfg["set_pane_title"] else None
        want = {"title": meta_title, "tokens": tokens}
        if self.last_report.get(tid) == want:
            return None
        params = {"pane_id": pane_id, "source": SOURCE, "tokens": tokens}
        if meta_title:
            params["title"] = meta_title
        else:
            # Simply not sending a title leaves the LAST one we sent in place
            # -- herdr keeps reported metadata until it is cleared, so a
            # daemon that stops overriding titles (prefer_terminal_title, or a
            # title that went away) would strand a stale one on the pane.
            params["clear_title"] = True
        return (pane_id, tid, params, want)

    def _send_pane_report(self, pane_id, tid, params, want):
        try:
            herdr_request("pane.report_metadata", params)
            with self.lock:
                self.last_report[tid] = want
        except (OSError, RuntimeError) as e:
            self.log("report_metadata %s failed: %s" % (pane_id, e))

    def _send_ws_report(self, ws, tokens):
        try:
            herdr_request(
                "workspace.report_metadata",
                {"workspace_id": ws, "source": SOURCE, "tokens": tokens},
            )
            with self.lock:
                if tokens.get("agents") is None:
                    self.ws_report.pop(ws, None)
                else:
                    self.ws_report[ws] = tokens
        except (OSError, RuntimeError) as e:
            self.log("ws metadata %s failed: %s" % (ws, e))
            if tokens.get("agents") is None:
                # Clearing a workspace that no longer exists (e.g. ids
                # regenerated by a server handoff) can never succeed — drop
                # it instead of retrying every tick forever.
                with self.lock:
                    self.ws_report.pop(ws, None)

    def _tab_label_for(self, title):
        """Truncate a session title to the configured tab-label length."""
        limit = self.cfg["tab_max_chars"]
        title = _WS_RE.sub(" ", title).strip()
        if len(title) <= limit:
            return title
        ell = self.cfg["tab_ellipsis"]
        cut = title[: max(1, limit - len(ell))]
        # Prefer a word boundary when one is reasonably close to the cut.
        if " " in cut[max(1, len(cut) // 2):]:
            cut = cut[: cut.rfind(" ")]
        return cut.rstrip(" ,;:.-") + ell

    def _tab_rename_items(self, tab_titles):
        """[(tab_id, label)] for tabs whose label should change.

        A tab is only managed while its label is herdr's default (the tab
        number) or the exact label this daemon last set — so a name you type
        yourself is never overwritten. Renaming one manually also releases
        the tab from management until it goes back to a default label.
        """
        items = []
        try:
            workspaces = herdr_request("workspace.list", {}).get("workspaces", [])
        except (OSError, RuntimeError):
            return items
        managed = self.tab_labels
        live = set()
        for ws in workspaces:
            ws_id = ws.get("workspace_id")
            try:
                tabs = herdr_request("tab.list", {"workspace_id": ws_id}).get("tabs", [])
            except (OSError, RuntimeError):
                continue
            for tab in tabs:
                tab_id = tab.get("tab_id")
                live.add(tab_id)
                want = tab_titles.get(tab_id)
                if not want:
                    continue
                label = tab.get("label") or ""
                default = str(tab.get("number", ""))
                ours = managed.get(tab_id)
                if self.cfg["tab_respect_manual"] \
                        and label not in ("", default) and label != ours:
                    continue  # a name Douglas typed — leave it alone
                want = self._tab_label_for(want)
                if want and want != label:
                    items.append((tab_id, want))
        for gone in [t for t in managed if t not in live]:
            managed.pop(gone, None)
        return items

    def _send_tab_rename(self, tab_id, label):
        try:
            herdr_request("tab.rename", {"tab_id": tab_id, "label": label})
            with self.lock:
                self.tab_labels[tab_id] = label
            self.log("tab %s -> %r" % (tab_id, label))
        except (OSError, RuntimeError) as e:
            self.log("tab rename %s failed: %s" % (tab_id, e))

    def _workspace_report_items(self, ws_agents):
        """Compute per-workspace rollup tokens; returns [(ws, tokens)] for
        entries that changed. Pure computation — no I/O (called under lock)."""
        items = []
        now = time.time()
        for ws, entries in ws_agents.items():
            counts = {"blocked": 0, "attention": 0, "working": 0, "idle": 0, "settled": 0}
            busiest = 0
            for status, st, _ in entries:
                if status == "blocked":
                    counts["blocked"] += 1
                elif status == "done" or st.get("unread"):
                    counts["attention"] += 1
                elif status == "working":
                    counts["working"] += 1
                    busiest = max(busiest, now - st.get("last_change", now))
                elif st.get("settled"):
                    counts["settled"] += 1
                else:
                    counts["idle"] += 1
            pieces = []
            # Idle is "○", NOT "·" — herdr joins row tokens with a "·"
            # separator, so a "·" glyph reads as a stray dash next to it.
            for key, sym in (
                ("blocked", "!"),
                ("attention", FLAG_UNREAD),
                ("working", "▸"),   # ▸
                ("idle", "○"),      # ○
                ("settled", FLAG_SETTLED),
            ):
                if not counts[key]:
                    continue
                # A lone idle agent is the workspace's default state — the
                # space's own status icon already says it; skip the noise.
                if key == "idle" and counts[key] == 1 and not pieces \
                        and not counts["settled"]:
                    continue
                pieces.append("%s%d" % (sym, counts[key]))
            tokens = {
                "agents": " ".join(pieces),
                "busy": ("▸%s" % fmt_dur(busiest)) if busiest else "",
            }
            if self.ws_report.get(ws) != tokens:
                items.append((ws, tokens))
        # Clear rollups for workspaces that no longer have agents.
        for ws in [w for w in self.ws_report if w not in ws_agents]:
            items.append((ws, {"agents": None, "busy": None}))
        return items

    def _prune(self, seen_tids, now):
        for tid, st in list(self.terminals.items()):
            if tid in seen_tids:
                continue
            gone = st.get("gone_since")
            if not gone:
                st["gone_since"] = now
                # Nothing else will wake the loop before the 30s tick, so the
                # archive would be that late however short the grace is.
                if st.get("pane_id") in self.closed_panes:
                    threading.Timer(CLOSED_GRACE_SECS + 0.5,
                                    self.dirty.set).start()
                continue
            # Archive the chat once the pane has been gone long enough that
            # this isn't just a server-restart or detection blip. When herdr
            # actually told us the pane closed, that doubt is gone and the
            # wait is only long enough to outlast a redraw -- waiting two
            # minutes to see a chat you just closed reads as "history is
            # broken".
            grace = CLOSED_GRACE_SECS if st.get("pane_id") in self.closed_panes \
                else GONE_GRACE_SECS
            if now - gone > grace and not st.get("gone_archived"):
                st["gone_archived"] = True
                st["history"] = self._archive_chat(st, now)
            if now - gone > STATE_KEEP_SECS:
                del self.terminals[tid]
                self.last_report.pop(tid, None)
                self.closed_panes.discard(st.get("pane_id"))

    # -- control commands (from actions.py / inbox TUI) --

    def handle_command(self, cmd):
        op = cmd.get("cmd")
        now = time.time()
        agents = None
        if op == "settle-workspace":
            # Network fetch happens BEFORE taking the lock.
            try:
                agents = herdr_request("agent.list", {}).get("agents", [])
            except (OSError, RuntimeError) as e:
                return {"ok": False, "error": str(e)}
        with self.lock:
            if op in ("settle", "unread", "clear"):
                tid = self.pane_to_tid.get(cmd.get("pane_id"))
                if not tid or tid not in self.terminals:
                    return {"ok": False, "error": "no agent in pane %s" % cmd.get("pane_id")}
                st = self.terminals[tid]
                if op == "settle":
                    st["settled"] = True
                    st["unread"] = False
                elif op == "unread":
                    st["unread"] = True
                    st["settled"] = False
                    st["flagged_at"] = now
                else:
                    st["settled"] = False
                    st["unread"] = False
                title = st.get("title") or st.get("agent") or ""
            elif op == "settle-workspace":
                ws = cmd.get("workspace_id")
                n = 0
                for rec in agents:
                    if rec.get("workspace_id") != ws:
                        continue
                    tid = rec.get("terminal_id")
                    st = self.terminals.get(tid)
                    if st and rec.get("agent_status") in ("done", "idle", "unknown"):
                        st["settled"] = True
                        st["unread"] = False
                        n += 1
                title = "%d agents" % n
            elif op == "set-title":
                tid = self.pane_to_tid.get(cmd.get("pane_id"))
                st = self.terminals.get(tid)
                if not st:
                    return {"ok": False, "error": "no agent in pane %s" % cmd.get("pane_id")}
                title = _clean_title(str(cmd.get("title") or ""))
                if not title:
                    return {"ok": False, "error": "empty/unusable title"}
                # Manual titles stick until the agent's session ref changes
                # (a new conversation) or an explicit retitle.
                st["title"] = title
                st["title_manual"] = True
                st["sum_hash"] = None
            elif op == "retitle":
                tid = self.pane_to_tid.get(cmd.get("pane_id"))
                st = self.terminals.get(tid)
                if not st:
                    return {"ok": False, "error": "no agent in pane %s" % cmd.get("pane_id")}
                st["title"] = None
                st["title_tried"] = 0
                st["sum_hash"] = None
                st["title_manual"] = False
                title = ""
            elif op == "ping":
                return {"ok": True, "pong": True}
            else:
                return {"ok": False, "error": "unknown cmd %r" % op}
        self.dirty.set()
        return {"ok": True, "title": title}

    def _on_focus(self, pane_id):
        with self.lock:
            tid = self.pane_to_tid.get(pane_id)
            st = self.terminals.get(tid)
            if st and st.get("unread") and time.time() - st.get("flagged_at", 0) > 1.5:
                st["unread"] = False
                self.dirty.set()

    # -- threads --

    def control_loop(self):
        try:
            os.unlink(self.control_path)
        except OSError:
            pass
        srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        srv.bind(self.control_path)
        os.chmod(self.control_path, 0o600)
        srv.listen(8)
        srv.settimeout(1.0)
        while not self.stop.is_set():
            try:
                conn, _ = srv.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            try:
                conn.settimeout(3.0)
                data = b""
                while not data.endswith(b"\n"):
                    chunk = conn.recv(1 << 14)
                    if not chunk:
                        break
                    data += chunk
                cmd = json.loads(data)
                if not isinstance(cmd, dict):
                    raise ValueError("command must be a JSON object")
                resp = self.handle_command(cmd)
            except Exception as e:  # the control thread must never die
                resp = {"ok": False, "error": str(e)}
            try:
                conn.sendall((json.dumps(resp) + "\n").encode())
            except OSError:
                pass
            conn.close()
        srv.close()

    def events_loop(self):
        subs = [
            {"type": "pane.updated"},
            {"type": "pane.created"},
            {"type": "pane.closed"},
            {"type": "pane.focused"},
            {"type": "pane.agent_detected"},
            {"type": "workspace.closed"},
        ]
        backoff = 1.0
        while not self.stop.is_set():
            s = None
            try:
                s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                s.settimeout(5.0)
                s.connect(herdr_socket_path())
                s.sendall(
                    (json.dumps({"id": "sub", "method": "events.subscribe",
                                 "params": {"subscriptions": subs}}) + "\n").encode()
                )
                s.settimeout(2.0)
                backoff = 1.0
                # A reconnect can mean the server restarted and lost all
                # reported metadata — forget what we think we've reported.
                with self.lock:
                    self.last_report.clear()
                    self.ws_report.clear()
                self.assert_view()   # re-assert after every (re)connect
                self.dirty.set()
                buf = b""
                while not self.stop.is_set():
                    try:
                        chunk = s.recv(1 << 16)
                    except socket.timeout:
                        continue
                    if not chunk:
                        raise OSError("event stream closed")
                    buf += chunk
                    while b"\n" in buf:
                        line, buf = buf.split(b"\n", 1)
                        self._on_event(line)
            except (OSError, RuntimeError) as e:
                self.log("event stream down (%s); retrying in %.0fs" % (e, backoff))
                time.sleep(backoff)
                backoff = min(backoff * 2, 30.0)
            finally:
                if s is not None:
                    try:
                        s.close()
                    except OSError:
                        pass

    def _on_event(self, line):
        try:
            evt = json.loads(line)
        except ValueError:
            return
        name = evt.get("event")
        data = evt.get("data") or {}
        if name == "pane_focused":
            self._on_focus(data.get("pane_id"))
        if name in ("pane_closed", "pane_exited") and data.get("pane_id"):
            # herdr says this one is really gone, so _prune can archive it
            # promptly instead of waiting out the blip grace.
            with self.lock:
                self.closed_panes.add(data.get("pane_id"))
        if name in ("pane_updated", "pane_created", "pane_closed",
                    "pane_agent_detected", "workspace_closed", "pane_focused"):
            self.dirty.set()

    def run(self):
        self.log("daemon starting (pid %d, title_source=%s, summarize=%s)"
                 % (os.getpid(), self.cfg["title_source"], self.cfg["summarize"]))
        threading.Thread(target=self.control_loop, daemon=True).start()
        threading.Thread(target=self.events_loop, daemon=True).start()
        threading.Thread(target=self.summarize_loop, daemon=True).start()
        while not self.stop.is_set():
            fired = self.dirty.wait(TICK_SECS)
            if fired:
                self.dirty.clear()
                time.sleep(DEBOUNCE_SECS)  # coalesce event bursts
                self.dirty.clear()
            self.refresh()


def _check_summarize():
    """Run summarize_cmd once against a sample thread and report.

    `--check-summarize` exists because the summarizer is the one part of this
    daemon that depends on something outside it (a working `pi`, a reachable
    model, a sandbox that lets it run). Run it from a normal pane and it says
    exactly what the daemon would see.
    """
    cfg = load_config()
    if not (cfg["summarize"] and cfg["summarize_cmd"]):
        print("summarize is off in CONFIG")
        return 1
    sample = ("Agent: pi\nWorkdir: ~/src/dotfiles\n\nConversation:\n"
              "port the herdr agent inbox into my dotfiles without plugins\n\n"
              "[\u2026]\n\nsummarize the thread with a cheap model instead of "
              "copying my first prompt into the title")
    env = dict(os.environ)
    env["PATH"] = env.get("PATH", "") + ":/opt/homebrew/bin:/usr/local/bin"
    print("$ %s" % cfg["summarize_cmd"])
    started = time.time()
    try:
        r = subprocess.run(cfg["summarize_cmd"], shell=True, env=env,
                           input=sample, capture_output=True, text=True,
                           timeout=cfg["summarize_timeout_secs"])
    except (OSError, subprocess.TimeoutExpired) as e:
        print("failed: %s" % e)
        return 1
    took = time.time() - started
    if r.returncode != 0:
        print("rc=%d in %.1fs" % (r.returncode, took))
        print((r.stderr or r.stdout or "").strip()[:500])
        hint = _sandbox_hint(r.stderr or r.stdout or "")
        if hint:
            print(hint.strip())
        return 1
    title = _clean_title(_summary_line(r.stdout))
    print("rc=0 in %.1fs" % took)
    print("raw stdout: %r" % r.stdout[-300:])
    print("title     : %r" % title)
    return 0 if title else 1


def _stop_running():
    """Kill the daemon holding the flock and wait for it to let go.

    Used by `--restart`. The pid in daemon.lock may have been recycled after a
    crash, so it is only killed when it still looks like us.
    """
    lock_path = os.path.join(state_dir(), "daemon.lock")
    try:
        pid = int(open(lock_path).readline().strip())
    except (OSError, ValueError):
        return
    try:
        cmd = subprocess.run(["ps", "-p", str(pid), "-o", "command="],
                             capture_output=True, text=True).stdout
    except OSError:
        return
    if "agent-inbox-daemon" not in cmd:
        return
    try:
        os.kill(pid, 15)
    except OSError:
        return
    for _ in range(25):
        try:
            os.kill(pid, 0)
        except OSError:
            return
        time.sleep(0.2)


def _daemonize():
    """Detach into our own session, so the daemon outlives its launcher.

    Whoever starts this must not own it: a keybinding's process exits
    immediately, and a pane's shell gets its whole process GROUP killed when
    the pane closes -- which silently took the inbox down with any pane it was
    ever started from. `nohup` does not help (that is SIGHUP only) and macOS
    ships no setsid(1), so the double fork lives here instead of in the fish
    helpers, where every caller would have to remember it.

    Standard two-fork: fork so we are not a process-group leader, setsid to
    leave the launcher's session and terminal behind, fork again so the
    session leader is gone and no controlling terminal can be acquired.
    """
    if os.getpid() == os.getsid(0):
        return                      # already detached (a re-exec, or a retry)
    if os.fork() > 0:
        os._exit(0)
    os.setsid()
    if os.fork() > 0:
        os._exit(0)
    # The launcher's stdio may be a pane that is about to disappear.
    fd = os.open(os.devnull, os.O_RDWR)
    for target in (0, 1, 2):
        try:
            os.dup2(fd, target)
        except OSError:
            pass
    if fd > 2:
        os.close(fd)


def main():
    # Everything this daemon writes derives from the user's private prompts;
    # nothing it creates should be group/world-readable.
    os.umask(0o077)
    argv = sys.argv[1:]
    if "--state-dir" in argv:
        # So the fish side never has to reimplement the path rule above.
        print(state_dir())
        return 0
    if "--check-summarize" in argv:
        return _check_summarize()
    if "--restart" in argv:
        _stop_running()
    if "--foreground" not in argv:
        _daemonize()
    d = InboxDaemon()
    for name in ("state.json", "history.jsonl", "daemon.log", "daemon.log.1",
                 "daemon.lock", "tui_prefs.json"):
        try:
            os.chmod(os.path.join(d.dir, name), 0o600)
        except OSError:
            pass
    lock_path = os.path.join(d.dir, "daemon.lock")
    # "a" so a losing candidate doesn't truncate the winner's recorded pid.
    lock_file = open(lock_path, "a")
    try:
        fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        print("herdr-agent-inbox daemon already running", file=sys.stderr)
        return 0
    lock_file.seek(0)
    lock_file.truncate()
    lock_file.write("%d\n" % os.getpid())
    lock_file.flush()
    try:
        d.run()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
