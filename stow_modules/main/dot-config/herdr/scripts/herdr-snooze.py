#!/usr/bin/env python3
"""Snooze: hide Herdr agents from the Agents panel until a deadline.

Standalone Python port of https://github.com/mrolafsson/herdr-snooze.
The core state machine follows the upstream 0.2 Python implementation.
Local code adds upstream 0.4/0.5 behavior: snooze until done/merged, wake
when an agent comes to need you, and the four-hour Just woke list/tokens.

How hiding works
    A snoozed pane carries `snoozed` and `herdr_snooze` metadata tokens, and
    the Agents view is filtered to `not(exists herdr_snooze)`. Tokens carry
    a TTL, so Herdr itself drops them at the deadline with no daemon running.

What `tick` is for
    The token TTL is capped at 24h, tokens and the view die with the server,
    and Herdr has ONE agent view that any caller can replace. `tick` (startup
    hook + a few event hooks) reconciles the state file against all three. It
    reads one small file and exits when nothing is snoozed.

Python 3.11+, standard library only.
"""

import contextlib
import copy
import fcntl
import hashlib
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import time
import unicodedata
import uuid
from datetime import datetime, timedelta

PLUGIN_ID = os.environ.get("HERDR_PLUGIN_ID") or "herdr-snooze"
SOURCE = "plugin:" + PLUGIN_ID
TOKEN = "snoozed"

MAX_TTL_MS = 86400000  # herdr's cap on a metadata token's ttl_ms
REFRESH_MARGIN_MS = 12 * 3600 * 1000  # re-report long snoozes this far before the token dies
MAX_SNOOZE_S = 366 * 86400

DEFAULT_DURATIONS = ["15m", "1h", "3h", "6h", "1d", "3d", "1w"]
DEFAULT_BADGE = "\U0001F4A4"  # 💤

# Token names aren't owned in herdr: any plugin could write `snoozed`. So every
# snoozed pane carries two: `snoozed`, the badge text people show in their
# sidebar ("$snoozed"), and MARK, which is snooze's alone. Filters and "is this
# ours?" go by MARK; `snoozed` is only for display.
MARK = "herdr_snooze"

VIEW_FILTER = {"op": "not", "filter": {"op": "exists", "field": {"token": MARK}}}
# The snoozed list also lets blocked agents through: it is the one panel state
# that hides your active agents, and one of them needing you is exactly what
# the panel exists to show.
SNOOZED_LIST_FILTER = {"op": "any", "filters": [
    {"op": "exists", "field": {"token": MARK}},
    {"op": "eq", "field": "status", "value": "blocked"},
]}

# herdr has a single agent view and its query is not readable: the only thing
# a caller can learn is the owner's `source` and `label`. So borrowing the view
# from a plugin that sorts the panel means re-stating its sort ourselves, and
# this table is how we know it. Unknown owners lose their sort while something
# is snoozed; teach snooze about one with "views" in config.json
# ({"<source>": {"<label>": [<sort>, …]}}), or pin a sort outright with "sort".
KNOWN_VIEWS = {
    "agent-handler": {
        "sorts": {
            "": [
                {"field": {"token": "um_pin"}, "order": "asc"},
                {"field": "attention", "order": "asc"},
                {"field": "state_change_seq", "order": "desc"},
            ],
            None: [
                {"field": {"token": "um_pin"}, "order": "asc"},
                {"field": "attention", "order": "asc"},
                {"field": "state_change_seq", "order": "desc"},
            ],
        },
    },
    "unread-marker": {
        "sorts": {
            "": [
                {"field": {"token": "um_pin"}, "order": "asc"},
                {"field": "attention", "order": "asc"},
                {"field": "state_change_seq", "order": "desc"},
            ],
            None: [
                {"field": {"token": "um_pin"}, "order": "asc"},
                {"field": "attention", "order": "asc"},
                {"field": "state_change_seq", "order": "desc"},
            ],
        },
    },
    "herdr-agent-inbox": {
        "sorts": {
            "Inbox": [
                {"field": {"token": "rank"}, "order": "asc"},
                {"field": "state_change_seq", "order": "desc"},
            ],
        },
    },
    "plugin:hhdebb.herdr-radar": {
        "sorts": {
            "active": [
                {"field": {"token": "ws_key"}, "order": "desc"},
                {"field": {"token": "tab_key"}, "order": "desc"},
                {"field": {"token": "sort_key"}, "order": "desc"},
            ],
            "recent": [{"field": {"token": "sort_key"}, "order": "desc"}],
        },
        # Radar turns its view off with a source-matched clear, which is a
        # no-op while we hold the view. Its persisted intent is the only trace.
        "off_flag": ("hhdebb.herdr-radar", "agent-view.on", "off"),
    },
}


# ── paths ────────────────────────────────────────────────────────────────────


def _herdr_state_root():
    base = os.environ.get("XDG_STATE_HOME") or os.path.join(os.path.expanduser("~"), ".local", "state")
    return os.path.join(base, "herdr", "plugins")


def plugin_state_dir():
    """The plugin's state directory. herdr gives one per plugin, shared by
    every herdr session on the machine."""
    return (
        os.environ.get("SNOOZE_STATE_DIR")
        or os.environ.get("HERDR_PLUGIN_STATE_DIR")
        or os.path.join(_herdr_state_root(), PLUGIN_ID)
    )


def default_socket():
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")
    return os.path.join(base, "herdr", "herdr.sock")


def socket_path():
    return os.environ.get("HERDR_SOCKET_PATH") or default_socket()


# A random ID snooze keeps next to the herdr session's socket, naming this
# incarnation of the session.
SESSION_ID_FILE = ".herdr-snooze-session"


def session_id_path(sock):
    """Where a socket's session ID lives. herdr's own sessions each have a
    directory with one herdr.sock in it, and keep the 0.1.1 name. A socket
    named anything else (a custom HERDR_SOCKET_PATH, perhaps one of several in
    /tmp) gets a file of its own, so sockets sharing a directory don't share
    an identity."""
    home, name = os.path.split(sock)
    if name == "herdr.sock":
        return os.path.join(home, SESSION_ID_FILE)
    return os.path.join(home, "%s-%s" % (SESSION_ID_FILE, name))


def read_session_id(sock):
    try:
        with open(session_id_path(sock), encoding="utf-8") as handle:
            return handle.read().strip() or None
    except OSError:
        return None


def session_id(sock):
    """The ID of the herdr session listening on `sock`, created on first use.
    A server restart keeps its directory and so the ID (snoozes are meant to
    survive it). Deleting a named session removes its directory, and with it
    the ID: a new session of the same name — whose panes herdr numbers from
    w1:p1 again — gets a new one, so it never reads the old one's records.
    None if the directory can't be written (then only the socket identifies
    the session)."""
    existing = read_session_id(sock)
    if existing:
        return existing
    path = session_id_path(sock)
    tmp = "%s.%d.tmp" % (path, os.getpid())
    try:
        with open(tmp, "w", encoding="utf-8") as handle:
            handle.write(uuid.uuid4().hex + "\n")
        try:
            # link, not rename: it fails if another process got there first,
            # and nobody ever reads a half-written file.
            os.link(tmp, path)
        except FileExistsError:
            pass
    except OSError:
        return None
    finally:
        with contextlib.suppress(OSError):
            os.remove(tmp)
    return read_session_id(sock)


def session_identity(sock=None):
    """What makes this herdr session this one: its socket and its session ID."""
    sock = os.path.realpath(sock or socket_path())
    return {"socket": sock, "id": session_id(sock)}


def session_key(identity=None):
    """A short key for one herdr session, from session_identity().

    Pane and workspace IDs only mean something inside one herdr session, but
    the plugin's state directory is shared by all of them: without a key per
    session, a second session would read the first one's snoozes, hide its
    own unrelated `w1:p1` or delete the first's records as closed panes."""
    ident = identity or session_identity()
    return hashlib.sha1(json.dumps(ident, sort_keys=True).encode("utf-8")).hexdigest()[:12]


def state_dir():
    """This session's state directory: sessions/<key>/ in the plugin's. run.sh's
    fast path must agree on where state can live: every sessions/*/, plus
    0.1.0's single file at the top (see recover_legacy)."""
    return os.path.join(plugin_state_dir(), "sessions", session_key())


def config_dir():
    if os.environ.get("HERDR_PLUGIN_CONFIG_DIR"):
        return os.environ["HERDR_PLUGIN_CONFIG_DIR"]
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")
    return os.path.join(base, "herdr", "plugins", "config", PLUGIN_ID)


# herdr's agent-view sort, as agent.view.set accepts it (src/api/schema/agents.rs):
# anything else and herdr refuses the whole view, on every sync.
SORT_FIELDS = {"workspace_order", "tab_order", "pane_order", "attention", "status", "agent", "seen", "state_change_seq"}


def _sort_key_ok(key):
    field = key.get("field") if isinstance(key, dict) else None
    token = field.get("token") if isinstance(field, dict) and len(field) == 1 else None
    named = isinstance(field, str) and field in SORT_FIELDS
    return (named or isinstance(token, str)) and key.get("order", "asc") in ("asc", "desc")


def _sort_ok(value):
    return isinstance(value, list) and all(_sort_key_ok(key) for key in value)


# Each setting: its default, and what a valid value looks like. A wrong value
# falls back to the default, with a note in the plugin log, instead of
# crashing a hook halfway through a change (and every hook after it).
CONFIG_SCHEMA = {
    "durations": (lambda: list(DEFAULT_DURATIONS),
                  lambda v: isinstance(v, list) and v and all(isinstance(d, (str, int)) for d in v)),
    "badge": (lambda: DEFAULT_BADGE, lambda v: isinstance(v, str)),
    "notify": (lambda: False, lambda v: isinstance(v, bool)),
    "sort": (lambda: None, lambda v: v is None or _sort_ok(v)),
    "views": (lambda: None, lambda v: v is None or (isinstance(v, dict) and all(
        isinstance(labels, dict) and all(_sort_ok(s) for s in labels.values()) for labels in v.values()))),
    "auto_return": (lambda: True, lambda v: isinstance(v, bool)),
    "wake_when_blocked": (lambda: True, lambda v: isinstance(v, bool)),
    "notify_wake": (lambda: True, lambda v: isinstance(v, bool)),
    "woke_badge": (lambda: "\u23f0", lambda v: isinstance(v, str)),
    "theme": (lambda: "", lambda v: isinstance(v, str) and v in ("", "dark", "light")),
}


def load_config():
    config = {key: default() for key, (default, _valid) in CONFIG_SCHEMA.items()}
    path = os.path.join(config_dir(), "config.json")
    try:
        with open(path, encoding="utf-8") as handle:
            user = json.load(handle)
    except FileNotFoundError:
        return config
    except (OSError, ValueError) as problem:
        log("config.json ignored, using defaults:", problem)
        return config
    if not isinstance(user, dict):
        log("config.json ignored: it must be a JSON object")
        return config
    for key, value in user.items():
        if key not in CONFIG_SCHEMA:
            continue
        if CONFIG_SCHEMA[key][1](value):
            config[key] = value
        else:
            log("config.json: %r has an invalid value; using the default" % key)
    return config


# ── herdr socket ─────────────────────────────────────────────────────────────


class HerdrError(Exception):
    def __init__(self, code, message):
        super().__init__("%s: %s" % (code, message))
        self.code = code


def call(method, params=None, timeout=5.0):
    """One request per connection: the server answers a line and hangs up."""
    path = socket_path()
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        sock.connect(path)
        sock.sendall((json.dumps({"id": "snooze", "method": method, "params": params or {}}) + "\n").encode("utf-8"))
        buf = b""
        while not buf.endswith(b"\n"):
            chunk = sock.recv(65536)
            if not chunk:
                break
            buf += chunk
    finally:
        sock.close()
    reply = json.loads(buf.decode("utf-8"))
    if reply.get("error"):
        raise HerdrError(reply["error"].get("code", "error"), reply["error"].get("message", ""))
    return reply.get("result") or {}


def notify(title, body=None):
    try:
        call("notification.show", {"title": title, "body": body})
    except (OSError, ValueError, HerdrError):
        pass


def log(*parts):
    # Plugin stdout is captured by herdr: `herdr plugin log list --plugin herdr-snooze`.
    print(*parts, flush=True)


# ── time ─────────────────────────────────────────────────────────────────────

_UNITS = {
    "s": 1, "sec": 1, "secs": 1, "second": 1, "seconds": 1,
    "m": 60, "min": 60, "mins": 60, "minute": 60, "minutes": 60,
    "h": 3600, "hr": 3600, "hrs": 3600, "hour": 3600, "hours": 3600,
    "d": 86400, "day": 86400, "days": 86400,
    "w": 604800, "wk": 604800, "wks": 604800, "week": 604800, "weeks": 604800,
}
_UNIT_NAMES = [(604800, "week"), (86400, "day"), (3600, "hour"), (60, "minute"), (1, "second")]
_PART = re.compile(r"\s*(\d+(?:\.\d+)?)\s*([a-z]*)")
_CLOCK = re.compile(r"(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$")


def _parse_clock(text):
    """'17:30', '9am', '9:15 pm' -> (hour, minute). A bare number is not a clock."""
    match = _CLOCK.match(text)
    if not match or (match.group(2) is None and match.group(3) is None):
        return None
    hour, minute = int(match.group(1)), int(match.group(2) or 0)
    if match.group(3):
        if not 1 <= hour <= 12:
            return None
        hour = hour % 12 + (12 if match.group(3) == "pm" else 0)
    if hour > 23 or minute > 59:
        return None
    return hour, minute


def parse_until(text, now=None):
    """Turn '15m', '1h30m', '2 days', '90' (minutes), '17:30', '9am' or
    'tomorrow [9am]' into a deadline. Raises ValueError with a user-facing
    message."""
    now = now or datetime.now()
    text = (text or "").strip().lower()
    if not text:
        raise ValueError("enter a duration like 45m, 2h, 3d or a time like 17:30")

    if text.startswith("tomorrow"):
        clock = _parse_clock(text[len("tomorrow"):].strip() or "9:00")
        if not clock:
            raise ValueError("try 'tomorrow' or 'tomorrow 14:00'")
        day = now + timedelta(days=1)
        return day.replace(hour=clock[0], minute=clock[1], second=0, microsecond=0)

    clock = _parse_clock(text)
    if clock:
        until = now.replace(hour=clock[0], minute=clock[1], second=0, microsecond=0)
        return until if until > now else until + timedelta(days=1)

    seconds, pos = 0.0, 0
    while pos < len(text):
        match = _PART.match(text, pos)
        if not match or match.end() == pos:
            raise ValueError("can't read '%s' — try 45m, 2h, 3d, 1w or 17:30" % text)
        unit = match.group(2) or "m"
        if unit not in _UNITS:
            raise ValueError("unknown unit '%s' — use s, m, h, d or w" % unit)
        seconds += float(match.group(1)) * _UNITS[unit]
        pos = match.end()
    if seconds <= 0:
        raise ValueError("duration must be more than zero")
    if seconds > MAX_SNOOZE_S:
        raise ValueError("that's more than a year — close the pane instead?")
    # Elapsed time, not wall-clock arithmetic: across a daylight-saving change
    # "2h" must still mean two hours from now (a clock time like 9am above
    # stays a clock time).
    return datetime.fromtimestamp(now.timestamp() + seconds)


def describe(spec):
    """Menu label for a configured duration: '15m' -> '15 minutes'."""
    text = str(spec).strip().lower()
    if text.startswith("tomorrow") or _parse_clock(text):
        return text if text.startswith("tomorrow") else "until " + text
    try:
        total = int((parse_until(text, datetime(2000, 1, 1)) - datetime(2000, 1, 1)).total_seconds())
    except ValueError:
        return text
    parts = []
    for size, name in _UNIT_NAMES:
        count, total = divmod(total, size)
        if count:
            parts.append("%d %s%s" % (count, name, "" if count == 1 else "s"))
    return " ".join(parts)


def format_until(until, now=None):
    now = now or datetime.now()
    if until.date() == now.date():
        return until.strftime("%H:%M")
    if until - now < timedelta(days=6):
        return until.strftime("%a %H:%M")
    return until.strftime("%d %b %H:%M").lstrip("0")


def format_left(ms):
    # Rounds up: a 3-minute snooze reads "3m" the moment it is set, not "2m".
    seconds = max(0, -(-int(ms) // 1000))
    if seconds < 60:
        return "%ds" % seconds
    minutes = -(-seconds // 60)
    if minutes < 60:
        return "%dm" % minutes
    hours, minutes = divmod(minutes, 60)
    if hours < 24:
        return "%dh %dm" % (hours, minutes) if minutes else "%dh" % hours
    days, hours = divmod(hours, 24)
    return "%dd %dh" % (days, hours) if hours else "%dd" % days


def badged(badge, text):
    """The badge, a gap, then text. A wide badge (an emoji such as 💤) gets two
    spaces: herdr's sidebar lets it cover the single space after it, so
    "💤 1" shows as "💤1"."""
    if not badge:
        return text
    wide = unicodedata.east_asian_width(badge[-1]) in ("W", "F")
    return badge + ("  " if wide else " ") + text


WHEN_DONE = "done"
WHEN_MERGED = "merged"
JUST_WOKE_MS = 4 * 3600 * 1000
WOKE_TOKEN = "snooze_woke"
WOKE_BADGE_TOKEN = "woke"


def condition_cap(now=None):
    return parse_until("tomorrow", now or datetime.now())


def condition_label(when):
    return "till " + when


def can_wait_for(when, pane):
    if when == WHEN_DONE:
        return pane.get("agent_status") == "working"
    if when == WHEN_MERGED:
        tokens = pane.get("tokens") or {}
        return bool(tokens.get("pr")) and tokens.get("pr_state") in ("open", "draft")
    return False


def pr_settled(pane):
    return (pane.get("tokens") or {}).get("pr_state") in ("merged", "closed")


def pane_label(pane):
    for value in (pane.get("title"), pane.get("terminal_title_stripped"), pane.get("terminal_title"), pane.get("agent")):
        if isinstance(value, str) and value.strip():
            return value.strip()
    return pane.get("pane_id") or "agent"


def wake_on_change(state, panes, wake_blocked=True):
    live = {pane.get("pane_id"): pane for pane in panes}
    for pid in list(state.get("panes", {})):
        entry = state["panes"][pid]
        pane = live.get(pid)
        if not pane or not pane.get("agent"):
            continue
        was = entry.get("status") or ""
        now_status = pane.get("agent_status") or ""
        entry["status"] = now_status
        reason = ""
        if wake_blocked and now_status == "blocked" and was and was != "blocked":
            reason = "it needs you"
        elif entry.get("when") == WHEN_DONE and was == "working" and now_status in ("done", "idle", "blocked"):
            reason = "it's done"
        elif entry.get("when") == WHEN_MERGED and pr_settled(pane):
            reason = "its pull request is " + str((pane.get("tokens") or {}).get("pr_state"))
        if not reason:
            continue
        del state["panes"][pid]
        space = state.get("workspaces", {}).get(entry.get("workspace_id"))
        if space is not None and pid not in space.setdefault("except", []):
            space["except"].append(pid)
        state.setdefault("_woken", []).append({
            "pane_id": pid, "name": pane_label(pane), "agent": pane.get("agent") or "",
            "workspace_id": pane.get("workspace_id") or "", "reason": reason,
            "space": entry.get("via") == "workspace",
        })
        log("woke", pid + ":", reason)


def woke_text(entry, now):
    text = format_until(from_ms(entry["at"]), from_ms(now))
    if entry.get("reason"):
        text += " \u00b7 " + entry["reason"]
    return text


def track_woke(state, panes, now, force=False, badge="\u23f0"):
    live = {pane.get("pane_id"): pane for pane in panes}
    for item in state.pop("_woken", []):
        pid = item.get("pane_id")
        pane = live.get(pid)
        if pane:
            state.setdefault("woke", {})[pid] = {
                "at": now, "reason": item.get("reason") or "",
                "agent_id": agent_identity(pane), "away": not bool(pane.get("focused")),
            }
            # Keep a copy for locked_state to announce after it saves.
            state.setdefault("_announce", []).append(item)
    # locked_state only announces _woken; merge _announce into it without saving it.
    if state.get("_announce"):
        state["_woken"] = state.pop("_announce")
    ops = []
    for pid in list(state.get("woke", {})):
        entry = state["woke"][pid]
        pane = live.get(pid)
        if pane is None:
            del state["woke"][pid]
            continue
        tokens = pane.get("tokens") or {}
        shown = WOKE_TOKEN in tokens
        if (pane.get("focused") and entry.get("away")) or pid in state.get("panes", {}) or now >= entry.get("at", 0) + JUST_WOKE_MS or replaced({"agent_id": entry.get("agent_id")}, pane):
            del state["woke"][pid]
            if shown or WOKE_BADGE_TOKEN in tokens:
                ops.append(("woke_clear", pid, "keep" if pid in state.get("panes", {}) else ""))
            continue
        entry["away"] = bool(entry.get("away") or not pane.get("focused"))
        if force or not shown:
            ops.append(("woke_report", pid, woke_text(entry, now), max(1, entry.get("at", now) + JUST_WOKE_MS - now), badge))
    return ops


def announce_wakes(woken):
    try:
        config = load_config()
    except Exception:
        config = {}
    if not woken or not config.get("notify_wake", True):
        return
    if len(woken) == 1:
        item = woken[0]
        reason = item.get("reason") or ""
        body = (reason[:1].upper() + reason[1:]) if reason else None
        notify((item.get("name") or "Agent") + " is awake", body)
    else:
        notify("%d agents are awake" % len(woken), ", ".join(item.get("name") or item.get("pane_id") or "agent" for item in woken))


def now_ms():
    return int(time.time() * 1000)


def to_ms(moment):
    return int(moment.timestamp() * 1000)


def from_ms(ms):
    return datetime.fromtimestamp(ms / 1000.0)


# ── state ────────────────────────────────────────────────────────────────────


def empty_state():
    return {"v": 1, "panes": {}, "workspaces": {}, "view": {}, "timer": None, "timer_pid": None, "woke": {}}


# A view record meaning "we may hold the view, but don't know what we set":
# the next sync then asks herdr and clears it if it's ours.
RECOVER = {"applied": "recover"}

# What each field of the view record may hold (plan_view reads them all).
VIEW_FIELDS = {"applied": str, "inherited": (dict, type(None)), "showing": str, "from_pane": (str, type(None)), "order": str}
INHERITED_FIELDS = {"source": (str, type(None)), "label": (str, type(None))}


def valid_view(view):
    """Whether a saved view record has only fields of the types plan_view
    reads, all the way down (a list where a label belongs crashed it)."""
    if not all(isinstance(view[k], types) for k, types in VIEW_FIELDS.items() if k in view):
        return False
    inherited = view.get("inherited")
    return inherited is None or all(
        isinstance(inherited[k], types) for k, types in INHERITED_FIELDS.items() if k in inherited
    )


def read_state():
    """The state file, or an empty state if there is none. A file that is
    there but can't be read in full (corrupt, a hand edit, a crash mid-write)
    is *not* taken as "nothing snoozed": tokens and our view may still be live
    in herdr, and dropping them unexamined could leave agents hidden with no
    record left to un-hide them. Such a state carries RECOVER, so the next sync
    fails open: it clears tokens it has no record for and our view."""
    try:
        with open(os.path.join(state_dir(), "snoozed.json"), encoding="utf-8") as handle:
            data = json.load(handle)
    except FileNotFoundError:
        return empty_state()
    except (OSError, ValueError):
        state = empty_state()
        state["view"] = dict(RECOVER)
        return state
    state = empty_state()
    # Snooze writes every key, every time, and deletes the file when idle: a
    # file that exists without them (or with the wrong types) is damaged,
    # never a quiet "nothing snoozed".
    damaged = not isinstance(data, dict) or any(not isinstance(data.get(k), dict) for k in ("panes", "workspaces", "view"))
    if isinstance(data, dict):
        # Every hook reads this file; one malformed entry (a hand edit, a
        # half-understood older version) must not make all of them crash.
        for key in ("panes", "workspaces"):
            if isinstance(data.get(key), dict):
                state[key] = {
                    name: entry for name, entry in data[key].items()
                    if isinstance(entry, dict) and isinstance(entry.get("until"), int)
                }
                damaged = damaged or len(state[key]) != len(data[key])
        if isinstance(data.get("view"), dict):
            view = dict(data["view"])
            if valid_view(view):
                state["view"] = view
            else:
                damaged = True  # its fields would crash planning: recover instead
        if isinstance(data.get("timer"), int):
            state["timer"] = data["timer"]
        if isinstance(data.get("timer_pid"), int):
            state["timer_pid"] = data["timer_pid"]
        if isinstance(data.get("woke"), dict):
            state["woke"] = {
                name: entry for name, entry in data["woke"].items()
                if isinstance(entry, dict) and isinstance(entry.get("at"), int)
            }
    if damaged and not state["view"]:
        state["view"] = dict(RECOVER)
    return state


def is_idle(state):
    return not state["panes"] and not state["workspaces"] and not state["view"] and not state.get("woke")


@contextlib.contextmanager
def locked_state():
    """Hooks can overlap (two events in the same instant), so every
    read-modify-write of the state file happens under one flock."""
    root = state_dir()
    os.makedirs(root, exist_ok=True)
    with open(os.path.join(root, "lock"), "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        ident_path = os.path.join(root, "session.json")
        if not os.path.exists(ident_path):
            # Which session this directory belongs to, so prune_stale_sessions
            # can tell when that session no longer exists. Written under the
            # lock (the pruner takes it too), under a name only we use.
            tmp = "%s.%d.tmp" % (ident_path, os.getpid())
            with open(tmp, "w", encoding="utf-8") as handle:
                json.dump(session_identity(), handle)
            os.replace(tmp, ident_path)
        state = read_state()
        before = json.dumps(state, sort_keys=True)
        pending_wakes = []
        try:
            yield state
        finally:
            pending_wakes = state.pop("_woken", [])
            # Also on failure: a herdr call can die after tokens were already
            # sent, and a token with no record is an agent hidden for up to a
            # day that no list shows. What we meant to do is the better record;
            # the next tick reconciles whatever did not land.
            path = os.path.join(root, "snoozed.json")
            if is_idle(state):
                # No file is the idle signal run.sh checks before starting Python.
                with contextlib.suppress(FileNotFoundError):
                    os.remove(path)
            elif json.dumps(state, sort_keys=True) != before:
                with open(path + ".tmp", "w", encoding="utf-8") as handle:
                    json.dump(state, handle, indent=1, sort_keys=True)
                os.replace(path + ".tmp", path)
            if pending_wakes:
                announce_wakes(pending_wakes)


def prune_stale_sessions():
    """Remove the state of herdr sessions that no longer exist.

    A deleted session's directory would otherwise stay forever: its file keeps
    run.sh starting Python in every session's hooks. Its records are safe to
    drop: tokens and views die with the server that held them, and a
    recreated session of the same name is a different one (session_key)."""
    root = os.path.join(plugin_state_dir(), "sessions")
    try:
        keys = os.listdir(root)
    except OSError:
        return
    mine = session_key()
    for key in keys:
        if key == mine:
            continue
        path = os.path.join(root, key)
        try:
            with open(os.path.join(path, "session.json"), encoding="utf-8") as handle:
                ident = json.load(handle)
            sock, recorded = ident["socket"], ident["id"]
        except (OSError, ValueError, KeyError, TypeError):
            # No identity (yet — it may be mid-creation) or can't read it:
            # unknown is never proof the session is gone.
            continue
        home = os.path.dirname(sock)
        if recorded is None:
            continue  # it couldn't write an ID: nothing to compare
        if os.path.isdir(home) and read_session_id(sock) == recorded:
            continue  # alive (running or just stopped)
        # Its directory is gone, or holds another incarnation's ID. Take its
        # lock, so nothing is mid-write; if it's busy, it isn't stale.
        try:
            with open(os.path.join(path, "lock"), "a") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                log("removing state of a herdr session that no longer exists:", key)
                shutil.rmtree(path, ignore_errors=True)
        except OSError:
            continue


# 0.1.0 kept one state file for every session, at the top of the plugin's
# state directory. Its records may belong to any session, so none adopts them.


def running_sessions():
    """The sockets of every running herdr session, or None if herdr can't
    say (then nothing may be assumed about the others)."""
    herdr = os.environ.get("HERDR_BIN_PATH") or "herdr"
    try:
        out = subprocess.run([herdr, "session", "list", "--json"], capture_output=True, text=True, timeout=5, check=True)
        sessions = json.loads(out.stdout).get("sessions", [])
        return [s["socket_path"] for s in sessions if s.get("running") and s.get("socket_path")]
    except (OSError, ValueError, AttributeError, KeyError, TypeError, subprocess.SubprocessError):
        return None


@contextlib.contextmanager
def in_session(sock):
    """Act as the herdr session behind `sock`: its state, its socket."""
    old = os.environ.get("HERDR_SOCKET_PATH")
    os.environ["HERDR_SOCKET_PATH"] = sock
    try:
        yield
    finally:
        if old is None:
            os.environ.pop("HERDR_SOCKET_PATH", None)
        else:
            os.environ["HERDR_SOCKET_PATH"] = old


def recover_legacy(config):
    """After upgrading from 0.1.0: fail open in every running session. For
    each one whose own state is idle, anything of ours still in it (our view,
    a token with no record) came from 0.1.0 — clear it, so agents reappear
    rather than stay hidden by a record no session will read again. Done
    through each session's own socket, by whichever session ticks first, so a
    quiet session isn't left out. A session that isn't running needs nothing:
    its view and tokens died with its server.

    The old file goes only once every running session has recovered, with
    every token clear confirmed; until then (herdr unreachable, a session
    refusing), it stays. One process recovers at a time (the others skip
    straight past), and after a failure the next attempt waits, doubling
    from LEGACY_RETRY_S up to LEGACY_RETRY_MAX_S: a refusing session must not
    turn every hook into seconds of retries. Sessions started with their own
    HERDR_SOCKET_PATH aren't listed by herdr, so aren't reached (see the
    README)."""
    root = plugin_state_dir()
    legacy = os.path.join(root, "snoozed.json")
    if not os.path.exists(legacy):
        return
    retry_path = os.path.join(root, "legacy-retry.json")
    try:
        with open(retry_path, encoding="utf-8") as handle:
            retry = json.load(handle)
        if time.time() < float(retry["at"]):
            return  # backing off after a failure
    except (OSError, ValueError, KeyError, TypeError):
        retry = {}
    with open(os.path.join(root, "legacy.lock"), "a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            return  # another process is recovering right now
        complete = _recover_every_session(config)
        if complete:
            for path in (legacy, retry_path):
                with contextlib.suppress(FileNotFoundError):
                    os.remove(path)
        else:
            delay = min(LEGACY_RETRY_MAX_S, max(LEGACY_RETRY_S, float(retry.get("delay", 0)) * 2))
            with contextlib.suppress(OSError), open(retry_path, "w", encoding="utf-8") as handle:
                json.dump({"at": time.time() + delay, "delay": delay}, handle)


LEGACY_RETRY_S = 30
LEGACY_RETRY_MAX_S = 3600


def _recover_every_session(config):
    """Returns True when every running session is known to be recovered."""
    socks = running_sessions()
    complete = socks is not None
    socks = list(socks or [])
    if os.path.realpath(socket_path()) not in [os.path.realpath(s) for s in socks]:
        socks.append(socket_path())
    for sock in socks:
        with in_session(sock):
            marker = os.path.join(state_dir(), "legacy-recovered")
            if os.path.exists(marker):
                continue
            try:
                with locked_state() as state:
                    if is_idle(state):
                        state["view"] = dict(RECOVER)
                    sync(state, config, strict=True)
                with open(marker, "w", encoding="utf-8") as handle:
                    handle.write("0.1.0 state recovered\n")
                log("recovered from 0.1.0 in", sock)
            except (OSError, ValueError, HerdrError) as problem:
                log("0.1.0 recovery not done yet in", sock, "-", problem)
                complete = False
    return complete


# ── reconcile (pure) ─────────────────────────────────────────────────────────


def _token_due(entry, now, present):
    if entry.pop("dirty", False) or not present:
        return True
    token_until = entry.get("token_until", 0)
    return token_until < entry["until"] and token_until - now < REFRESH_MARGIN_MS


def _token_op(kind, target, entry, now, badge):
    ttl = max(1, min(entry["until"] - now, MAX_TTL_MS))
    entry["token_until"] = now + ttl
    if entry.get("when"):
        value = badged(badge, condition_label(entry["when"]))
    else:
        value = badged(badge, format_until(from_ms(entry["until"]), from_ms(now)))
    return (kind, target, value, ttl)


def reconcile(state, panes, now, force=False, badge=DEFAULT_BADGE):
    """Bring `state` in line with the live panes and the clock. Mutates
    `state`; returns the token ops the caller must send:
    ("report", pane_id, value, ttl) | ("clear", pane_id) |
    ("ws_report", workspace_id, value, ttl) | ("ws_clear", workspace_id)."""
    ops = []
    live = {pane["pane_id"]: pane for pane in panes}
    live_workspaces = {pane.get("workspace_id") for pane in panes}
    follow_terminals(state, panes, live)

    for wid in list(state["workspaces"]):
        space = state["workspaces"][wid]
        if wid not in live_workspaces:
            # No panes left in it. If the space itself is gone the clear just
            # fails quietly; if it is merely empty, this takes its badge off.
            ops.append(("ws_clear", wid))
            del state["workspaces"][wid]
            continue
        if now >= space["until"]:
            ops.append(("ws_clear", wid))
            del state["workspaces"][wid]
            continue
        # Agents in the space join it — including ones that start later (the
        # pane.agent_detected hook lands here) — unless that pane was
        # deliberately woken, or given its own deadline. Shells are left alone:
        # a token on one hides nothing and makes every count lie.
        for pane in panes:
            pid = pane["pane_id"]
            if not pane.get("agent"):
                continue
            if pane.get("workspace_id") == wid and pid not in state["panes"] and pid not in space.get("except", []):
                state["panes"][pid] = {
                    "until": space["until"], "via": "workspace", "workspace_id": wid, "dirty": True,
                    "agent_id": agent_identity(pane), "terminal_id": pane.get("terminal_id"), "since": now,
                }
        # Workspace tokens are not visible from pane.list, so only the clock
        # (or a forced pass after a server restart) can say one needs sending.
        if _token_due(space, now, present=not force):
            ops.append(_token_op("ws_report", wid, space, now, badge))

    for pid in list(state["panes"]):
        entry = state["panes"][pid]
        pane = live.get(pid)
        if pane is None:
            del state["panes"][pid]
            continue
        if now >= entry["until"]:
            # The TTL normally got here first; this covers a late token (herdr's
            # clock pauses while the machine sleeps) and makes wake-ups explicit.
            ops.append(("clear", pid))
            del state["panes"][pid]
            if pane.get("agent"):
                state.setdefault("_woken", []).append({
                    "pane_id": pid, "name": pane_label(pane), "agent": pane.get("agent") or "",
                    "workspace_id": pane.get("workspace_id") or "", "reason": "",
                    "space": entry.get("via") == "workspace",
                })
            continue
        if replaced(entry, pane):
            space = state["workspaces"].get(entry.get("workspace_id"))
            if entry.get("via") == "workspace" and space is not None:
                # A snoozed space covers whatever agent runs in it: keep it
                # hidden, as this agent's own record.
                entry["agent_id"] = agent_identity(pane)
                entry.pop("agent_gone", None)
            else:
                # The agent that was snoozed exited and another started in
                # the same pane: the snooze was for that one, not this.
                ops.append(("clear", pid))
                del state["panes"][pid]
                continue
        present = MARK in (pane.get("tokens") or {})
        if _token_due(entry, now, present=present and not force):
            ops.append(_token_op("report", pid, entry, now, badge))

    # A token with no record behind it (state file lost, a run that died
    # halfway) is an agent hidden for up to a day that no list shows. MARK is
    # ours alone; a `snoozed` token without it is taken for ours only if 0.1.x
    # could have written it (it starts with our badge): another plugin's stays.
    cleared = {op[1] for op in ops if op[0] == "clear"}
    for pid, pane in live.items():
        tokens = pane.get("tokens") or {}
        if pid in state.get("woke", {}) and MARK not in tokens:
            continue
        ours = MARK in tokens or (TOKEN in tokens and looks_ours(tokens[TOKEN], badge))
        if pid not in state["panes"] and pid not in cleared and ours:
            ops.append(("clear", pid))
    return ops


def looks_ours(value, badge):
    """Whether a `snoozed` token without MARK is one snooze 0.1.x wrote:
    _token_op always started it with the badge. With no badge configured
    there's nothing to tell by, so it's taken for ours."""
    return not badge or str(value).startswith(badge)


def follow_terminals(state, panes, live):
    """herdr gives a pane moved to another space or tab a new ID, but it keeps
    its terminal. Re-key what we hold for it by terminal_id, so the snooze (or
    a wake-up exception) follows the pane from whatever pane.list shows,
    whatever order concurrent hooks run in, and however many moves ago.
    Mutates `state`; everything learns its terminal while its pane is live."""
    by_terminal = {pane["terminal_id"]: pane for pane in panes if pane.get("terminal_id")}
    for pid in list(state["panes"]):
        entry = state["panes"][pid]
        pane = live.get(pid)
        if pane is not None:
            if pane.get("terminal_id"):
                entry["terminal_id"] = pane["terminal_id"]
            continue
        pane = by_terminal.get(entry.get("terminal_id"))
        if pane is None:
            continue  # closed: reconcile forgets it
        del state["panes"][pid]
        new = pane["pane_id"]
        if new in state["panes"]:
            continue  # it already has a record of its own
        if entry.get("via") == "workspace" and pane.get("workspace_id") != entry.get("workspace_id"):
            entry["via"] = "pane"  # it left the snoozed space: it keeps its own deadline
        entry["workspace_id"] = pane.get("workspace_id")
        entry["dirty"] = True  # the token may not have come along
        state["panes"][new] = entry
    for space in state["workspaces"].values():
        if not space.get("except"):
            continue
        known = space.get("except_terminals") if isinstance(space.get("except_terminals"), dict) else {}
        kept, terminals = [], {}
        for pid in space["except"]:
            pane = live.get(pid) or by_terminal.get(known.get(pid))
            if pane is None:
                continue  # closed: nothing left to except
            if pane["pane_id"] not in kept:
                kept.append(pane["pane_id"])
            if pane.get("terminal_id"):
                terminals[pane["pane_id"]] = pane["terminal_id"]
        space["except"], space["except_terminals"] = kept, terminals


def agent_identity(pane):
    """Which kind of agent runs in a pane, or None when there's no agent."""
    return {"agent": pane["agent"]} if pane.get("agent") else None


def replaced(entry, pane):
    """Whether the agent in the pane is not the one that was snoozed: another
    kind, or any agent after this pane was seen with none, or after herdr
    reported the snoozed one leaving or another arriving (agent_detected,
    below).

    pane.list carries no process identity, and agent_session changes on the
    same agent's /clear, resume and compact, so neither can tell. What herdr
    does give: pane.agent_detected when an agent's process exits (a release,
    so a quick restart of the same agent is seen too; not on /clear and the
    like); and `agent` cleared when the agent exits, or after several missed probes
    while something else holds the foreground, so an agent that hands its
    terminal to an editor for a while loses its snooze and shows again. A
    record from before 0.2 (no identity) adopts the agent it finds."""
    current = agent_identity(pane)
    if current is None:
        entry["agent_gone"] = True  # it hides nothing until an agent returns
        return False
    if entry.get("agent_gone"):
        return True
    recorded = entry.get("agent_id")
    if not isinstance(recorded, dict):
        entry["agent_id"] = current
        return False
    return recorded.get("agent") != current["agent"]


# An agent herdr reports arriving this soon after a snooze began is the
# snoozed agent's own detection, delivered late: the picker only offers panes
# whose agent herdr already had.
DETECTED_GRACE_MS = 10 * 1000


def agent_detected(state, event, received):
    """herdr's pane.agent_detected: sent when a pane's agent comes, goes or
    changes kind, and when an agent is released (for Claude, Codex and the
    like, that is its process exiting), with `released` set and `agent` still
    naming the one that left. If a snooze in that pane predates it, the agent
    it was for is gone: the next reconcile treats the pane as replaced. A
    release, or the agent leaving, counts at once; an agent arriving counts
    only after DETECTED_GRACE_MS. Returns True if a record was marked.

    `received` is when the hook started, not when it got the lock: herdr runs
    hooks concurrently and in no order, so a release of the agent before can
    reach the lock after the one that replaced it was snoozed. An event from
    before the snooze is not about it."""
    entry = state["panes"].get(event.get("pane_id"))
    if entry is None:
        return False
    age = received - entry.get("since", 0)
    left = event.get("released") is True or not event.get("agent")
    if age < 0 or (not left and age < DETECTED_GRACE_MS):
        return False
    entry["agent_gone"] = True
    return True


def detected_event(event):
    """The part of a pane.agent_detected hook's event JSON that names the pane
    (with its `agent` and `released` beside it), wherever herdr nests it, or
    None."""
    if isinstance(event, dict):
        if isinstance(event.get("pane_id"), str):
            return event
        for value in event.values():
            found = detected_event(value)
            if found:
                return found
    return None


def known_sort(owner, views=None):
    """The sort behind another plugin's view, if we know it. `views` is the
    user's config.json table and wins over the built-in one."""
    source, label = (owner or {}).get("source"), (owner or {}).get("label")
    user = (views or {}).get(source)
    if isinstance(user, dict) and isinstance(user.get(label), list):
        return user[label]
    known = KNOWN_VIEWS.get(source)
    return known["sorts"].get(label) if known else None


# herdr's own panel order, for when nobody else holds the view. Any view hides
# the panel's "grouped"/"priority" label (and its toggle) behind the view's own
# label, and a view with no sort gets the server's config.toml order, not the
# one toggled in the client. So we re-state both. The sorts are herdr 0.9.1's
# (src/app/agent_view.rs): spaces is plain workspace/tab/pane order, priority
# is attention then latest state change.
PANEL_MODES = {
    "spaces": ("grouped", [
        {"field": "workspace_order", "order": "asc"},
        {"field": "tab_order", "order": "asc"},
        {"field": "pane_order", "order": "asc"},
    ]),
    "priority": ("priority", [
        {"field": "attention", "order": "desc"},
        {"field": "state_change_seq", "order": "desc"},
    ]),
}


def _mode_name(value):
    value = {"workspaces": "spaces"}.get(value, value)
    return value if value in PANEL_MODES else None


def _fnv1a64(text):
    value = 0xcbf29ce484222325
    for byte in text.encode("utf-8"):
        value = ((value ^ byte) * 0x100000001b3) & 0xFFFFFFFFFFFFFFFF
    return value


def panel_mode(sock=None, state_home=None, config_home=None):
    """herdr's current panel order: "spaces" or "priority". A toggle in the
    client wins; herdr saves it per client, in a file named by a hash of the
    client socket (the API socket with "-client" before ".sock"). Otherwise
    [ui] agent_panel_sort in config.toml, otherwise herdr's default."""
    sock = sock or socket_path()
    root, ext = os.path.splitext(sock)
    client_sock = root + "-client" + ext if ext == ".sock" else sock + "-client"
    state_home = state_home or os.environ.get("XDG_STATE_HOME") or os.path.join(os.path.expanduser("~"), ".local", "state")
    prefs = os.path.join(state_home, "herdr", "client-shell", "local-%016x.json" % _fnv1a64(client_sock))
    try:
        with open(prefs, encoding="utf-8") as handle:
            mode = _mode_name(json.load(handle).get("agent_panel_sort"))
        if mode:
            return mode
    except (OSError, ValueError, AttributeError):
        pass
    config_home = config_home or os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")
    try:
        with open(os.path.join(config_home, "herdr", "config.toml"), encoding="utf-8") as handle:
            section = None
            for line in handle:
                line = line.split("#", 1)[0].strip()
                header = re.match(r"\[([^\]]+)\]$", line)
                if header:
                    section = header.group(1).strip()
                    continue
                found = re.match(r'agent_panel_sort\s*=\s*"([^"]*)"$', line)
                if section == "ui" and found:
                    return _mode_name(found.group(1)) or "spaces"
    except OSError:
        pass
    return "spaces"


def owner_turned_off(owner, state_root=None):
    known = KNOWN_VIEWS.get((owner or {}).get("source"))
    if not known or not known.get("off_flag"):
        return False
    plugin, filename, off_value = known["off_flag"]
    try:
        with open(os.path.join(state_root or _herdr_state_root(), plugin, filename), encoding="utf-8") as handle:
            return handle.read().strip() == off_value
    except OSError:
        return False


def settle_showing(state, focused):
    """The snoozed list is somewhere you visit, not a mode to get stuck in: a
    panel that keeps listing only snoozed agents hides the one that just got
    blocked. So it ends by itself once focus lands on a pane that is not
    snoozed — other than the pane you opened it from, which is where focus
    still is while you read the list. Returns True when it switched back."""
    view = state["view"]
    if view.get("showing") != "snoozed" or focused is None:
        return False
    if focused in state["panes"]:
        view["from_pane"] = None  # went to look at one; any other pane now means "done here"
        return False
    if focused == view.get("from_pane"):
        return False
    view.pop("showing")
    view.pop("from_pane", None)
    return True


def plan_view(state, owner, count, sort_override=None, badge=DEFAULT_BADGE, owner_off=False, views=None, blocked=0, mode=None):
    """Decide what to do with herdr's single agent view. `owner` is the probe
    result ({active, source, label}); `count` is how many *agents* are snoozed
    and `blocked` how many active ones are blocked. `mode` is herdr's own panel
    order (panel_mode), kept when there is no other owner to borrow from.
    Mutates state["view"]; returns ("set", params), ("clear", params) or None."""
    view = state["view"]
    mine = bool(owner.get("active")) and owner.get("source") == SOURCE
    inherited = view.get("inherited")
    if owner.get("active") and not mine:
        inherited = {"source": owner.get("source"), "label": owner.get("label")}
        # If we had the snoozed list up and it got replaced, someone just
        # worked their own panel control. Re-taking the view is how hiding
        # keeps working; putting the snoozed list back on top would undo what
        # they asked for — and the safe side to land on is normal. (Not when
        # the list was only just asked for and isn't up yet: that is a toggle
        # arriving while another plugin happens to hold the view.)
        try:
            had_list_up = json.loads(view.get("applied") or "{}").get("filter") == SNOOZED_LIST_FILTER
        except (ValueError, TypeError, AttributeError):
            had_list_up = False
        if had_list_up:
            view.pop("showing", None)
            view.pop("from_pane", None)
    elif not owner.get("active"):
        inherited = None
    if owner_off:
        inherited = None

    # `count`, not state["panes"]: a record with no agent behind it (a shell, an
    # agent that exited) hides nothing, and a filter held for it would make the
    # snoozed list an empty panel.
    if count:
        # `order` is the `order` command's flip of herdr's own order: herdr
        # won't let its label be clicked while we hold the view. It lasts
        # only while we do (herdr keeps its own mode in the client), so the
        # label marks it with "*".
        order = _mode_name(view.get("order")) if not inherited else None
        native_label, native_sort = PANEL_MODES.get(order or mode, (None, None)) if not inherited else (None, None)
        if order and order != mode and native_label:
            native_label += "*"
        base = (inherited or {}).get("label") or native_label
        # `showing` is the toggle: the same panel, flipped to list what is
        # snoozed. The two labels must not be confusable — one means "N are
        # hidden from this list", the other "this list IS the hidden ones".
        showing_snoozed = view.get("showing") == "snoozed"
        if showing_snoozed:
            label = badged(badge, "snoozed only · %d" % count) + (" + %d blocked" % blocked if blocked else "")
        else:
            label = "%s %s" % (base, badged(badge, str(count))) if base else badged(badge, str(count))
        want = {
            "source": SOURCE,
            "label": label.strip(),
            "filter": SNOOZED_LIST_FILTER if showing_snoozed else VIEW_FILTER,
            "sort": sort_override or known_sort(inherited, views) or native_sort or [],
        }
        fingerprint = json.dumps(want, sort_keys=True)
        state["view"] = {"inherited": inherited, "applied": fingerprint}
        if order and order != mode:
            state["view"]["order"] = order
        if showing_snoozed:
            state["view"]["showing"] = "snoozed"
            state["view"]["from_pane"] = view.get("from_pane")
        if mine and view.get("applied") == fingerprint:
            return None
        return ("set", want)

    state["view"] = {}
    if not mine:
        return None
    sort = known_sort(inherited, views)
    if inherited and sort is not None:
        # Hand the borrowed view back exactly as we found it, under its
        # owner's source, so that owner's own toggles keep working.
        return ("set", {"source": inherited["source"], "label": inherited.get("label"), "sort": sort})
    return ("clear", {"source": SOURCE})


# ── sync: reconcile + talk to herdr ──────────────────────────────────────────


def send_token_ops(ops):
    """Returns the ops herdr refused."""
    failed = []
    for op in ops:
        kind, target = op[0], op[1]
        try:
            if kind == "report":
                call("pane.report_metadata", {"pane_id": target, "source": SOURCE, "tokens": {TOKEN: op[2], MARK: "1"}, "ttl_ms": op[3]})
            elif kind == "clear":
                call("pane.report_metadata", {"pane_id": target, "source": SOURCE, "tokens": {TOKEN: None, MARK: None}})
            elif kind == "ws_report":
                call("workspace.report_metadata", {"workspace_id": target, "source": SOURCE, "tokens": {TOKEN: op[2], MARK: "1"}, "ttl_ms": op[3]})
            elif kind == "ws_clear":
                call("workspace.report_metadata", {"workspace_id": target, "source": SOURCE, "tokens": {TOKEN: None, MARK: None}})
            elif kind == "woke_report":
                tokens = {WOKE_TOKEN: op[2]}
                if len(op) > 4 and op[4]:
                    tokens[WOKE_BADGE_TOKEN] = op[4]
                    tokens[TOKEN] = op[4]
                call("pane.report_metadata", {"pane_id": target, "source": SOURCE, "tokens": tokens, "ttl_ms": op[3]})
            elif kind == "woke_clear":
                tokens = {WOKE_TOKEN: None, WOKE_BADGE_TOKEN: None}
                if len(op) < 3 or op[2] != "keep":
                    tokens[TOKEN] = None
                call("pane.report_metadata", {"pane_id": target, "source": SOURCE, "tokens": tokens})
        except HerdrError as error:
            log("token op failed:", op, error)  # a pane closing mid-sync is not worth aborting for
            failed.append(op)
    return failed


def probe_view():
    # A clear whose source owns nothing changes nothing and reports the owner.
    return call("agent.view.clear", {"source": SOURCE + ".probe"})


TIMER_SCRIPT = 'sleep "$1" && exec /usr/bin/env python3 "$2" tick --timer'


def _spawn_timer(delay_s):
    """Starts the sleeper and returns its PID (arm_timer keeps it)."""
    launcher = os.path.abspath(__file__)
    return subprocess.Popen(
        [TIMER_SHELL, "-c", TIMER_SCRIPT, TIMER_NAME, str(delay_s), launcher],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        start_new_session=True, close_fds=True,
    ).pid


TIMER_SHELL = "/bin/sh"
TIMER_NAME = "snooze-timer"  # its $0, so a sleeper can be told apart from a reused PID
# At most this long between ticks while anything is snoozed, whatever the
# deadlines: herdr has no event for another plugin taking the agent view, so
# this is how snooze notices (and how a dead sleeper is noticed on a quiet
# machine).
SAFETY_MS = 5 * 60 * 1000


def timer_alive(pid):
    """Whether our sleeper is still there. A signal-0 probe: cheap, but a PID
    can be reused, so killing it goes through is_our_timer first."""
    if not isinstance(pid, int) or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return False  # someone else's process has that PID now


def is_our_timer(pid):
    """Whether the process is one of our sleepers: its whole command line, not
    a word in it, before we'd stop its process group."""
    signature = "%s -c %s %s " % (TIMER_SHELL, TIMER_SCRIPT, TIMER_NAME)
    try:
        out = subprocess.run(["ps", "-o", "command=", "-p", str(pid)], capture_output=True, text=True, timeout=2)
        return out.stdout.startswith(signature)
    except (OSError, subprocess.SubprocessError):
        return False


def stop_timer(pid):
    if timer_alive(pid) and is_our_timer(pid):
        with contextlib.suppress(OSError):
            os.killpg(pid, 15)  # its own session/group: the sleep goes with it


def arm_timer(state, now, spawn=None):
    """One detached `sleep` that runs a tick at the next moment something needs
    doing (a deadline, a token due for refresh, or SAFETY_MS at the latest).

    herdr's TTL already un-hides the agent on time; what nothing does on time
    is *us* noticing: the label keeps its count, the view stays borrowed, and
    in the snoozed list the last agent expiring leaves an empty panel. And a
    snooze longer than the TTL cap must be re-reported before its token dies.
    Not a daemon: each sleeper ticks once and is gone. Its PID is kept, so a
    sleeper that died (killed, a machine sleep) is replaced by the next tick
    instead of being trusted until the snooze ends early."""
    entries = list(state["panes"].values()) + list(state["workspaces"].values())
    entries += [{"until": entry.get("at", 0) + JUST_WOKE_MS, "token_until": entry.get("at", 0) + JUST_WOKE_MS} for entry in state.get("woke", {}).values()]
    if not entries:
        stop_timer(state.get("timer_pid"))
        state["timer"], state["timer_pid"] = None, None
        return
    soonest = min(
        entry["until"] if entry.get("token_until", entry["until"]) >= entry["until"]
        else min(entry["until"], entry["token_until"] - REFRESH_MARGIN_MS + 1000)
        for entry in entries
    )
    current, pid = state.get("timer"), state.get("timer_pid")
    if isinstance(current, int) and now < current <= soonest and timer_alive(pid):
        return  # a live sleeper will tick in time, and re-arm then
    wake_at = min(soonest, now + SAFETY_MS)
    try:
        new_pid = (spawn or _spawn_timer)(max(1, (wake_at - now) // 1000 + 1))
    except OSError as error:
        log("timer not armed:", error)  # hooks still catch up, just later
        return
    stop_timer(pid)  # the one it replaces, if it's still sleeping
    state["timer"], state["timer_pid"] = wake_at, new_pid if isinstance(new_pid, int) else None


def focused_pane(panes, agents_only=False):
    return next(
        (pane["pane_id"] for pane in panes if pane.get("focused") and (pane.get("agent") or not agents_only)), None
    )


def sync(state, config, force=False, strict=False):
    """Reconcile state with herdr. strict (recovery) raises if herdr refused
    to clear any token, rather than letting the caller take it as done."""
    panes = call("pane.list").get("panes", [])
    now = now_ms()
    wake_on_change(state, panes, wake_blocked=config.get("wake_when_blocked", True))
    ops = reconcile(state, panes, now, force=force, badge=config["badge"])
    ops += track_woke(state, panes, now, force=force, badge=config.get("woke_badge", "\u23f0"))
    failed = send_token_ops(ops)
    for op in failed:
        # Workspace tokens can't be read back, so nothing else would notice.
        entry = state["workspaces" if op[0].startswith("ws_") else "panes"].get(op[1]) if not op[0].startswith("woke_") else None
        if entry is not None and op[0] in ("report", "ws_report"):
            entry["dirty"] = True
    if strict and any(op[0] in ("clear", "ws_clear") for op in failed):
        raise HerdrError("recovery_incomplete", "herdr refused to clear %d token(s)" % len(failed))
    # Only an *agent* pane counts as "went back to work": a shell, or the
    # picker popup itself taking focus, is not that.
    if config["auto_return"] and settle_showing(state, focused_pane(panes, agents_only=True)):
        log("left the snoozed list: focus moved to an active agent")
    if force:
        # A restart. The sleeper may be gone, and nobody wants herdr to come
        # back up listing only snoozed agents.
        state["timer"] = None
        state["view"].pop("showing", None)
        state["view"].pop("from_pane", None)
    arm_timer(state, now)

    owner = probe_view()
    agents = {pane["pane_id"] for pane in panes if pane.get("agent")}
    count = len([pid for pid in state["panes"] if pid in agents])
    blocked = len([p for p in panes if p.get("agent") and p.get("agent_status") == "blocked" and p["pane_id"] not in state["panes"]])
    # Whose "off" flag to honour: the plugin holding the view right now, and
    # only while we hold it ourselves, the one we borrowed it from.
    foreign = owner.get("active") and owner.get("source") != SOURCE
    view_before = copy.deepcopy(state["view"])
    try:
        action = plan_view(
            state, owner, count,
            sort_override=config["sort"], badge=config["badge"], views=config["views"], blocked=blocked,
            mode=panel_mode(), owner_off=owner_turned_off(owner if foreign else state["view"].get("inherited")),
        )
    except Exception:
        # Whatever went wrong, never leave the view record half-planned:
        # "idle" would delete the file with our filter maybe still live.
        state["view"] = view_before or dict(RECOVER)
        raise
    if action:
        try:
            call("agent.view.set" if action[0] == "set" else "agent.view.clear", action[1])
        except (OSError, ValueError, HerdrError):
            # plan_view already recorded the view as changed. If this was the
            # last clear, that record would read "idle", the file would be
            # deleted, run.sh would stop starting Python — and herdr would
            # keep our filter, hiding agents, with nothing left to retry.
            # Keep what was true before, so the next hook tries again.
            state["view"] = view_before or dict(RECOVER)
            raise
    if ops or action:
        log("sync:", len(ops), "token op(s);", "view " + action[0] if action else "view unchanged")
    return panes


def snooze(kind, target, until, config, expect_agent=None, when=""):
    """kind is 'pane' or 'workspace'. Returns how many panes are now covered.

    expect_agent is the agent the picker showed. The popup can stay open a
    while; if that pane has since closed, moved (a new pane ID), or a
    different agent started in it, snoozing now would hide something the
    person never chose — so it's refused instead."""
    until_ms = to_ms(until)
    with locked_state() as state:
        if kind == "workspace":
            state["workspaces"][target] = {"until": until_ms, "dirty": True}
            for entry in state["panes"].values():
                if entry.get("workspace_id") == target:
                    entry.update({"until": until_ms, "via": "workspace", "dirty": True})
        else:
            record = {"until": until_ms, "via": "pane", "dirty": True, "since": now_ms()}
            if when:
                record["when"] = when
            # Populate identity/status even for CLI calls, so conditional
            # wakes and moved-pane tracking have the same record as picker calls.
            try:
                current = next((p for p in call("pane.list").get("panes", []) if p["pane_id"] == target), None)
            except Exception:
                current = None
            if current is not None:
                record["agent_id"] = agent_identity(current)
                record["terminal_id"] = current.get("terminal_id")
                record["workspace_id"] = current.get("workspace_id")
                record["status"] = current.get("agent_status") or ""
            if expect_agent is not None:
                pane = next((p for p in call("pane.list").get("panes", []) if p["pane_id"] == target), None)
                if pane is None:
                    raise ValueError("that pane moved or closed; open snooze on it again")
                if agent_identity(pane) is None:
                    raise ValueError("the agent there has exited; open snooze on it again")
                if replaced({"agent_id": expect_agent}, pane):
                    raise ValueError("a different agent is running there now; open snooze on it again")
                record["agent_id"] = agent_identity(pane)
                record["terminal_id"] = pane.get("terminal_id")
            state["panes"][target] = record
            # Its own deadline now outranks its space's: without this, a shorter
            # snooze ends, the agent reappears, and the space re-adopts it a
            # tick later for the rest of the space's (longer) snooze.
            for space in state["workspaces"].values():
                if target not in space.setdefault("except", []):
                    space["except"].append(target)
        panes = sync(state, config)
        for pane in panes:  # remember where a pane lives, so a later workspace snooze/wake finds it
            if pane["pane_id"] in state["panes"]:
                state["panes"][pane["pane_id"]]["workspace_id"] = pane.get("workspace_id")
        if kind == "workspace":
            return len([e for e in state["panes"].values() if e.get("workspace_id") == target])
        return 1 if target in state["panes"] else 0


def wake(config, pane_ids=(), workspace_ids=(), everything=False):
    with locked_state() as state:
        ops = []
        spaces = list(state["workspaces"]) if everything else [w for w in workspace_ids if w in state["workspaces"]]
        for wid in spaces:
            del state["workspaces"][wid]
            ops.append(("ws_clear", wid))
        for pid in list(state["panes"]):
            entry = state["panes"][pid]
            in_woken_space = entry.get("via") == "workspace" and entry.get("workspace_id") in spaces
            if not (everything or pid in pane_ids or in_woken_space):
                continue
            del state["panes"][pid]
            ops.append(("clear", pid))
            space = state["workspaces"].get(entry.get("workspace_id"))
            if space is not None and pid not in space.setdefault("except", []):
                space["except"].append(pid)  # woken early out of a still-snoozed space: don't re-adopt it
        for pid in list(state.get("woke", {})):
            if everything or pid in pane_ids:
                del state["woke"][pid]
                ops.append(("woke_clear", pid))
        send_token_ops(ops)
        sync(state, config)
        return len([op for op in ops if op[0] == "clear"])


# ── TUI (the popup) ──────────────────────────────────────────────────────────

BOLD, DIM, REVERSE, RESET = "\x1b[1m", "\x1b[2m", "\x1b[7m", "\x1b[0m"
_KEYS = {
    b"\x1b[A": "up", b"\x1bOA": "up", b"k": "up", b"\x10": "up",
    b"\x1b[B": "down", b"\x1bOB": "down", b"j": "down", b"\x0e": "down",
    b"\x1b[5~": "pgup", b"\x1b[6~": "pgdn", b"\x1b[H": "home", b"\x1b[F": "end",
    b"\x1b[1~": "home", b"\x1b[4~": "end",
    b"\r": "enter", b"\n": "enter",
    b"\x1b": "esc", b"\x03": "esc", b"q": "esc",
    b"\x7f": "backspace", b"\x08": "backspace",
}


def decode_key(data):
    """One key's bytes -> (name, raw bytes). Anything unnamed is 'char'."""
    return ("eof", b"") if not data else (_KEYS.get(data, "char"), data)


_SEQUENCES = sorted((seq for seq in _KEYS if len(seq) > 1), key=len, reverse=True)


def split_keys(data):
    """One read can carry several keys (a held arrow, a paste): split it, so
    `↓↓` moves twice instead of being one unknown blob that moves nothing."""
    keys = []
    while data:
        known = next((seq for seq in _SEQUENCES if data.startswith(seq)), None)
        if known:
            size = len(known)
        elif data[:1] == b"\x1b" and len(data) > 1:
            size = len(data)  # an escape sequence we don't know: swallow it whole, never half
        else:
            lead = data[0]
            size = 1 if lead < 0xC0 else 2 if lead < 0xE0 else 3 if lead < 0xF0 else 4  # one UTF-8 character
        keys.append(data[:size])
        data = data[size:]
    return keys


class RawTerminal:
    def __enter__(self):
        import termios
        import tty

        self.fd = sys.stdin.fileno()
        self.pending = []
        self.saved = termios.tcgetattr(self.fd)
        tty.setraw(self.fd)
        try:
            self.rows = os.get_terminal_size(self.fd).lines
        except OSError:
            self.rows = 24
        sys.stdout.write("\x1b[?25l")
        return self

    def __exit__(self, *exc):
        import termios

        termios.tcsetattr(self.fd, termios.TCSADRAIN, self.saved)
        sys.stdout.write("\x1b[?25h\x1b[2J\x1b[H")
        sys.stdout.flush()

    def key(self):
        if not self.pending:
            data = os.read(self.fd, 64)
            if data == b"\x1b":
                # A lone ESC is either the Escape key or the first byte of an
                # arrow whose rest is still in flight. Waiting a moment to find
                # out beats closing the popup on a ↓.
                import select

                if select.select([self.fd], [], [], 0.05)[0]:
                    data += os.read(self.fd, 64)
            self.pending = split_keys(data) or [b""]
        return decode_key(self.pending.pop(0))

    def draw(self, lines):
        sys.stdout.write("\x1b[2J\x1b[H" + "\r\n".join(lines))
        sys.stdout.flush()


def clip(text, width):
    text = " ".join(str(text or "").split())
    return text if len(text) <= width else text[: max(0, width - 1)] + "…"


def menu(term, header, items, footer, selected=0):
    """items: (hotkey, label, hint). Returns the chosen index, or None."""
    while True:
        # Keep the selection on screen when there are more rows than the popup
        # has lines; the blank lines above and below double as "more" markers.
        room = max(3, getattr(term, "rows", 100) - len(header) - 4)
        top = 0 if len(items) <= room else min(max(0, selected - room // 2), len(items) - room)
        above, below = top, max(0, len(items) - top - room)
        lines = [""] + header + ["  " + DIM + "↑ %d more" % above + RESET if above else ""]
        for index, (hotkey, label, hint) in list(enumerate(items))[top:top + room]:
            row = " %s  %-20s " % (hotkey or " ", clip(label, 20))
            lines.append(" " + REVERSE + row + hint + " " + RESET if index == selected else " " + row + DIM + hint + RESET)
        lines += ["  " + DIM + "↓ %d more" % below + RESET if below else "", "  " + DIM + footer + RESET]
        term.draw(lines)

        name, raw = term.key()
        if name in ("esc", "eof"):
            return None
        if name == "up":
            selected = (selected - 1) % len(items)
        elif name == "down":
            selected = (selected + 1) % len(items)
        elif name == "enter":
            return selected
        else:
            typed = raw.decode("utf-8", "ignore").lower()
            for index, item in enumerate(items):
                if typed and typed == item[0]:
                    return index


def prompt(term, header, question):
    """One-line input. Returns a datetime, or None on esc."""
    text, error = "", ""
    while True:
        term.draw(
            [""] + header + ["", "  " + question, "", "  " + BOLD + "› " + RESET + text + "▏", "",
             "  " + (error or DIM + "45m · 2h · 3d · 1w · 17:30 · tomorrow 9am" + RESET), "",
             "  " + DIM + "enter confirm · esc back" + RESET]
        )
        name, raw = term.key()
        if name in ("eof",) or raw in (b"\x1b", b"\x03"):
            return None
        if name == "enter":
            try:
                return parse_until(text)
            except ValueError as problem:
                error = clip(str(problem), 44)
        elif name == "backspace":
            text, error = text[:-1], ""
        else:
            typed = raw.decode("utf-8", "ignore")
            if typed.isprintable():
                text, error = text + typed, ""


def _snooze_env(name, default=""):
    return os.environ.get("HERDR_SNOOZE_" + name) or os.environ.get("SNOOZE_" + name) or default


def _popup_refs():
    try:
        plugins = call("plugin.list").get("plugins", [])
    except Exception:
        return {}
    out = {}
    for plugin in plugins:
        if not plugin.get("enabled"):
            continue
        for pane in plugin.get("panes") or []:
            if pane.get("id") == "picker" and pane.get("placement") == "popup":
                out[plugin.get("plugin_id")] = {
                    "plugin_id": plugin.get("plugin_id"), "entrypoint": pane.get("id"),
                    "width": pane.get("width"), "height": pane.get("height"),
                }
    return out


def _spawn_handoff(ref):
    subprocess.Popen(
        [sys.executable, os.path.abspath(__file__), "handoff", json.dumps(ref)],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        start_new_session=True, close_fds=True,
    )


def _return_ref():
    raw = os.environ.get("HERDR_POPUP_RETURN") or ""
    try:
        ref = json.loads(raw)
    except ValueError:
        return None
    if isinstance(ref, dict) and ref.get("plugin_id") and ref.get("entrypoint"):
        return ref
    return None


def picker_for_target(term, config, kind, target, label, detail, expect=None, status="", pr="", snoozed=False):
    header = ["  " + BOLD + clip(label or target, 42) + RESET]
    if detail:
        header.append("  " + DIM + clip(detail, 42) + RESET)
    now = datetime.now()
    choices = []
    for spec in config["durations"][:9]:
        try:
            choices.append((describe(spec), str(spec), parse_until(str(spec), now)))
        except ValueError:
            continue
    items = [(str(i + 1), text, format_until(until, now)) for i, (text, _spec, until) in enumerate(choices)]
    items.append(("c", "Custom\u2026", ""))
    conditions = []
    if kind == "pane" and status == "working":
        conditions.append((WHEN_DONE, "d", "until done"))
    if kind == "pane" and pr:
        conditions.append((WHEN_MERGED, "m", "until " + pr + " is merged"))
    for when, hotkey, text in conditions:
        items.append((hotkey, text, "or " + format_until(condition_cap(now), now)))
    if snoozed:
        items.append(("w", "Wake now", ""))
    index = 0
    while True:
        index = menu(term, header, items, "\u2191\u2193 move \u00b7 enter select \u00b7 esc cancel", selected=index)
        if index is None:
            return None
        if snoozed and index == len(items) - 1:
            if kind == "workspace":
                wake(config, workspace_ids=[target])
            else:
                wake(config, pane_ids=[target])
            return "woke %s" % (label or target)
        cond_index = index - len(choices) - 1
        if 0 <= cond_index < len(conditions):
            when = conditions[cond_index][0]
            until = condition_cap(datetime.now())
            covered = snooze(kind, target, until, config, expect_agent=expect if isinstance(expect, dict) else None, when=when)
            return "snoozed %s %s (%d pane(s)) %s" % (kind, target, covered, condition_label(when))
        if index < len(choices):
            until = parse_until(choices[index][1])
        else:
            until = prompt(term, header, "Snooze for how long, or until when?")
        if until is None:
            continue
        covered = snooze(kind, target, until, config, expect_agent=expect if isinstance(expect, dict) else None)
        return "snoozed %s %s (%d pane(s)) until %s" % (kind, target, covered, until.strftime("%Y-%m-%d %H:%M"))


def picker_snooze(term, config):
    if _snooze_env("SCREEN") == "list" or os.environ.get("HERDR_SNOOZE_DEMO") == "1":
        return picker_manage(term, config, demo=os.environ.get("HERDR_SNOOZE_DEMO") == "1")
    kind = _snooze_env("KIND", "pane")
    target = _snooze_env("TARGET") or _snooze_env("PANE")
    label = _snooze_env("LABEL")
    detail = _snooze_env("DETAIL")
    status = _snooze_env("STATUS")
    pr = _snooze_env("PR")
    expect = None
    try:
        parsed = json.loads(_snooze_env("AGENT") or "null")
        expect = parsed if isinstance(parsed, dict) else None
    except ValueError:
        expect = None
    if target and kind == "pane" and (not label or not status):
        try:
            pane = next((p for p in call("pane.list").get("panes", []) if p.get("pane_id") == target), None)
        except Exception:
            pane = None
        if pane:
            label = label or pane_label(pane)
            status = status or pane.get("agent_status") or ""
            expect = expect or agent_identity(pane)
            tokens = pane.get("tokens") or {}
            if can_wait_for(WHEN_MERGED, pane):
                pr = pr or str(tokens.get("pr") or "")
            detail = detail or pane.get("agent") or ""
    state = read_state()
    snoozed = target in state.get("workspaces", {}) if kind == "workspace" else target in state.get("panes", {})
    return picker_for_target(term, config, kind, target, label, detail, expect=expect, status=status, pr=pr, snoozed=snoozed)


def _manage_rows(state, panes, labels):
    live = {p.get("pane_id"): p for p in panes}
    rows = []
    woke = []
    for pid, entry in state.get("woke", {}).items():
        pane = live.get(pid)
        if pane and pane.get("agent"):
            woke.append({"kind": "pane", "id": pid, "title": pane_label(pane), "status": pane.get("agent_status") or "", "woke": entry, "pane": pane, "space": pane.get("workspace_id") or ""})
    woke.sort(key=lambda row: row["woke"].get("at", 0), reverse=True)
    snoozed_rows = []
    covered = set()
    for wid in sorted(state.get("workspaces", {})):
        under = []
        for pid, entry in state.get("panes", {}).items():
            pane = live.get(pid)
            if pane and entry.get("workspace_id") == wid and entry.get("via") == "workspace":
                under.append({"kind": "pane", "id": pid, "title": pane_label(pane), "status": pane.get("agent_status") or "", "snoozed": True, "until": entry.get("until", 0), "via": "workspace", "when": entry.get("when") or "", "pane": pane, "space": wid})
                covered.add(pid)
        under.sort(key=lambda row: row["id"])
        snoozed_rows.append({"kind": "space", "id": wid, "title": labels.get(wid) or wid, "snoozed": True, "until": state["workspaces"][wid].get("until", 0), "count": len(under), "space": wid})
        snoozed_rows.extend(under)
    own = []
    for pid, entry in state.get("panes", {}).items():
        pane = live.get(pid)
        if pane and pid not in covered:
            own.append({"kind": "pane", "id": pid, "title": pane_label(pane), "status": pane.get("agent_status") or "", "snoozed": True, "until": entry.get("until", 0), "via": entry.get("via") or "pane", "when": entry.get("when") or "", "pane": pane, "space": pane.get("workspace_id") or ""})
    own.sort(key=lambda row: (row["until"], row["id"]))
    snoozed_rows.extend(own)
    awake = []
    for pane in panes:
        pid = pane.get("pane_id")
        if pane.get("agent") and pid not in state.get("panes", {}) and pid not in state.get("woke", {}):
            awake.append({"kind": "pane", "id": pid, "title": pane_label(pane), "status": pane.get("agent_status") or "", "pane": pane, "space": pane.get("workspace_id") or ""})
    def section(title, items):
        if items:
            rows.append({"kind": "header", "id": title, "title": title, "count": len(items)})
            rows.extend(items)
    section("Just woke", woke)
    section("Snoozed", snoozed_rows)
    section("Awake", awake)
    return rows


def picker_manage(term, config, demo=False):
    selected = 0
    flash = ""
    while True:
        if demo:
            now = now_ms()
            panes = [
                {"pane_id": "w1:p1", "workspace_id": "w1", "agent": "claude", "agent_status": "blocked", "title": "Fix the login bug", "tokens": {}},
                {"pane_id": "w1:p2", "workspace_id": "w1", "agent": "codex", "agent_status": "working", "title": "Add rate limiting", "tokens": {}},
                {"pane_id": "w2:p1", "workspace_id": "w2", "agent": "claude", "agent_status": "idle", "title": "Release notes", "tokens": {}},
            ]
            state = {"panes": {"w2:p1": {"until": now + 3600000, "via": "pane", "workspace_id": "w2"}}, "workspaces": {}, "woke": {"w1:p1": {"at": now - 60000, "reason": "it's done"}}}
            labels = {"w1": "storefront", "w2": "docs"}
        else:
            try:
                panes = call("pane.list").get("panes", [])
                spaces = call("workspace.list").get("workspaces", [])
            except Exception as problem:
                term.draw(["", "  " + BOLD + "Snooze didn't work" + RESET, "", "  " + clip(str(problem), 60), "", "  " + DIM + "press any key" + RESET])
                term.key()
                return None
            labels = {w.get("workspace_id"): w.get("label") or w.get("workspace_id") for w in spaces}
            state = read_state()
        rows = _manage_rows(state, panes, labels)
        selectable = [i for i, row in enumerate(rows) if row["kind"] != "header"]
        if selectable and selected not in selectable:
            selected = selectable[0]
        now = now_ms()
        lines = ["  " + BOLD + "Snooze" + RESET, ""]
        if not rows:
            lines.append("  " + DIM + "No agents running." + RESET)
        for i, row in enumerate(rows):
            if row["kind"] == "header":
                lines.append(" " + BOLD + row["title"] + RESET + DIM + " %d" % row["count"] + RESET)
                continue
            if row["kind"] == "space":
                text = "space " + row["title"] + "  %d agent(s)" % row.get("count", 0)
                right = format_left(row.get("until", 0) - now)
            else:
                text = row["title"] + "  " + (row["pane"].get("agent") or "") + " \u00b7 " + (labels.get(row.get("space")) or "")
                if row.get("snoozed") and row.get("when"):
                    right = condition_label(row["when"])
                elif row.get("snoozed"):
                    right = format_left(row.get("until", 0) - now) + " \u00b7 " + format_until(from_ms(row.get("until", 0)), from_ms(now))
                elif row.get("woke"):
                    right = "woke " + format_until(from_ms(row["woke"].get("at", now)), from_ms(now))
                else:
                    right = row.get("status") or ""
            line = " %-48s %s" % (clip(text, 48), right)
            lines.append(" " + REVERSE + line + RESET if i == selected else " " + line)
        lines += ["", "  " + DIM + clip(flash, 64) + RESET, "  " + DIM + "\u2191\u2193 move \u00b7 enter go \u00b7 s snooze \u00b7 w wake \u00b7 S space \u00b7 r recap \u00b7 W wake all \u00b7 esc close" + RESET]
        term.draw(lines)
        name, raw = term.key()
        if name in ("esc", "eof"):
            return None
        if not selectable:
            continue
        pos = selectable.index(selected) if selected in selectable else 0
        if name == "up":
            selected = selectable[max(0, pos - 1)]
        elif name == "down":
            selected = selectable[min(len(selectable) - 1, pos + 1)]
        elif name == "pgup":
            selected = selectable[max(0, pos - 8)]
        elif name == "pgdn":
            selected = selectable[min(len(selectable) - 1, pos + 8)]
        elif name in ("home",) or raw == b"g":
            selected = selectable[0]
        elif name == "end" or raw == b"G":
            selected = selectable[-1]
        elif name == "enter":
            row = rows[selected]
            target_pane = row["id"]
            if row["kind"] == "space":
                target_pane = next((p.get("pane_id") for p in panes if p.get("workspace_id") == row["id"] and p.get("agent")), "")
            if demo:
                flash = "Demo agents cannot be focused."
            elif target_pane:
                call("agent.focus", {"target": target_pane})
                return "focused " + target_pane
            else:
                flash = "No agent in that space to go to."
        else:
            typed = raw.decode("utf-8", "ignore")
            row = rows[selected]
            if typed == "w" and row.get("snoozed"):
                if not demo:
                    if row["kind"] == "space":
                        wake(config, workspace_ids=[row["id"]])
                    else:
                        wake(config, pane_ids=[row["id"]])
                flash = "Woke " + row["title"]
            elif typed == "W":
                if not demo:
                    wake(config, everything=True)
                flash = "Woke everything"
            elif typed == "s" or (typed == "S" and row.get("space")):
                if demo:
                    flash = "Demo only."
                    continue
                if typed == "S" or row["kind"] == "space":
                    wid = row["id"] if row["kind"] == "space" else row["space"]
                    outcome = picker_for_target(term, config, "workspace", wid, labels.get(wid) or wid, "space", snoozed=wid in state.get("workspaces", {}))
                else:
                    pane = row["pane"]
                    tokens = pane.get("tokens") or {}
                    outcome = picker_for_target(term, config, "pane", row["id"], row["title"], pane.get("agent") or "", expect=agent_identity(pane), status=pane.get("agent_status") or "", pr=str(tokens.get("pr") or "") if can_wait_for(WHEN_MERGED, pane) else "", snoozed=bool(row.get("snoozed")))
                flash = outcome or flash
            elif typed == "r" and row["kind"] == "pane":
                refs = _popup_refs()
                recap = refs.get("herdr-recap")
                if demo:
                    flash = "Demo only."
                elif not recap:
                    flash = "Recap is not installed."
                else:
                    back = {"plugin_id": PLUGIN_ID, "entrypoint": "picker", "width": "72%", "height": "70%", "env": {"HERDR_SNOOZE_SCREEN": "list", "HERDR_SNOOZE_PANE": row["id"]}}
                    recap = dict(recap)
                    recap["env"] = {"HERDR_RECAP_PANE": row["id"], "HERDR_POPUP_RETURN": json.dumps(back)}
                    _spawn_handoff(recap)
                    return "opened recap"
                

def popup_file():
    """The running picker's pid. herdr shows one popup at a time, open as long
    as its command runs, on whichever client counts as active: with several
    attached (another terminal, a mosh session) the picker can be left open
    on one you're not looking at, and every open after fails with ui_busy.
    An open that meets that ends the picker named here (end_own_popup)."""
    return os.path.join(plugin_state_dir(), "popup.pid")


@contextlib.contextmanager
def noted_popup():
    """Record this process as the picker while it runs; forget it after,
    unless a newer picker has replaced it."""
    pid = str(os.getpid())
    try:
        os.makedirs(plugin_state_dir(), exist_ok=True)
        with open(popup_file(), "w", encoding="utf-8") as handle:
            handle.write(pid)
    except OSError:
        yield
        return
    try:
        yield
    finally:
        with contextlib.suppress(OSError):
            with open(popup_file(), encoding="utf-8") as handle:
                mine = handle.read().strip() == pid
            if mine:
                os.remove(popup_file())


def is_own_popup(pid):
    """Whether pid is this plugin's picker, not a stranger given the pid
    after ours exited."""
    try:
        with open("/proc/%d/cmdline" % pid, "rb") as handle:
            args = handle.read().decode("utf-8", "replace").split("\0")
    except OSError:
        try:
            out = subprocess.run(["ps", "-o", "command=", "-p", str(pid)], capture_output=True, text=True, timeout=3)
        except (OSError, subprocess.SubprocessError):
            return False
        args = out.stdout.split()
    return any(os.path.basename(a) in ("herdr-snooze.py", "snooze.py") for a in args) and "picker" in args


def end_own_popup():
    """End our picker if one is running, and wait for it to go: whether it
    was ours to end. Someone else's popup is theirs to close."""
    try:
        with open(popup_file(), encoding="utf-8") as handle:
            pid = int(handle.read().strip())
    except (OSError, ValueError):
        return False
    if pid <= 1 or not is_own_popup(pid):
        return False
    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        return False
    for _ in range(20):
        try:
            os.kill(pid, 0)
        except OSError:
            return True
        time.sleep(0.05)
    return False


def _quit_on_sigterm(signum, frame):
    # A newer open replacing this picker: leave through RawTerminal's exit, so
    # the terminal is restored.
    raise SystemExit(0)


def run_picker(args=None):
    config = load_config()
    if args and "--demo" in args:
        os.environ["HERDR_SNOOZE_DEMO"] = "1"
    if args and "--list" in args:
        os.environ["HERDR_SNOOZE_SCREEN"] = "list"
    signal.signal(signal.SIGTERM, _quit_on_sigterm)
    with noted_popup():
        code = _run_picker(config)
    ref = _return_ref()
    if ref is not None and (_snooze_env("PANE") or _snooze_env("SCREEN")):
        _spawn_handoff(ref)
    return code


def _run_picker(config):
    with RawTerminal() as term:
        try:
            outcome = picker_snooze(term, config)
        except (OSError, ValueError, HerdrError) as problem:
            # The popup closes with the process, so an error that only went to
            # the log would look like the picker silently doing nothing.
            log("picker failed:", problem)
            term.draw(["", "  " + BOLD + "Snooze didn't work" + RESET, "", "  " + clip(str(problem), 44), "",
                       "  " + DIM + "press any key" + RESET])
            term.key()
            return 1
    if outcome:
        log(outcome)
        if config["notify"] and outcome.startswith("snoozed"):
            notify("Snoozed", outcome.split(" until ")[-1])
    return 0


# ── actions (what herdr invokes) ─────────────────────────────────────────────


def open_picker(env, rows):
    both = {}
    for key, value in env.items():
        both[key] = value
        if key.startswith("HERDR_SNOOZE_"):
            both[key[len("HERDR_"):]] = value
        elif key.startswith("SNOOZE_"):
            both["HERDR_" + key] = value
    params = {
        "plugin_id": PLUGIN_ID, "entrypoint": "picker", "placement": "popup", "focus": True,
        "width": 50, "height": rows, "env": both,
    }
    replaced = False
    for attempt in range(5):
        try:
            call("plugin.pane.open", params)
            return 0
        except HerdrError as error:
            if error.code == "ui_busy" and attempt >= 3 and not replaced:
                # Still busy: if it's our picker left open elsewhere, end it
                # and open here; someone else's popup is theirs to close.
                replaced = end_own_popup()
                if replaced:
                    continue
                notify("Snooze", "Another popup is open: close it (esc) and try again.")
                log("open failed:", error)
                return 1
            # The menu this action was picked from may still be closing.
            if error.code != "ui_busy" or attempt == 4:
                notify("Snooze", "Couldn't open the picker: %s" % error)
                log("open failed:", error)
                return 1
            time.sleep(0.15)
    return 1


def context_pane_id(context):
    """The pane an action was invoked on. Plugin actions carry it in
    HERDR_PLUGIN_CONTEXT_JSON; [[keys.command]] shell commands get
    HERDR_ACTIVE_PANE_ID instead (HERDR_PANE_ID only exists inside a
    pane's own shell)."""
    return (
        context.get("focused_pane_id")
        or os.environ.get("HERDR_ACTIVE_PANE_ID")
        or os.environ.get("HERDR_PANE_ID")
    )


def context_workspace_id(context):
    return (
        context.get("workspace_id")
        or os.environ.get("HERDR_ACTIVE_WORKSPACE_ID")
        or os.environ.get("HERDR_WORKSPACE_ID")
    )


def invocation_context():
    try:
        context = json.loads(os.environ.get("HERDR_PLUGIN_CONTEXT_JSON") or "{}")
    except ValueError:
        context = {}
    return context if isinstance(context, dict) else {}


def run_action(name):
    context = invocation_context()
    log("action", name, "via", context.get("invocation_source"), "pane", context.get("focused_pane_id"), "workspace", context.get("workspace_id"))
    config = load_config()
    # durations + Custom + chrome, and never less than the Custom prompt needs
    height = max(min(len(config["durations"]), 9) + 10, 13)

    if name == "wake":
        # The one-step way out, for the snoozed list: no popup to get through.
        pane_id = context_pane_id(context)
        if pane_id not in read_state()["panes"] and pane_id not in read_state().get("woke", {}):
            notify("Snooze", "This agent isn't snoozed.")
            return 0
        wake(config, pane_ids=[pane_id])
        return 0

    if name in ("manage", "demo"):
        env = {"HERDR_SNOOZE_SCREEN": "list"}
        if name == "demo":
            env["HERDR_SNOOZE_DEMO"] = "1"
        return open_picker(env, 24)

    if name == "workspace":
        wid = context_workspace_id(context)
        if wid in read_state()["workspaces"]:
            wake(config, workspace_ids=[wid])  # the same action wakes it: one key, both ways
            return 0
        spaces = {w["workspace_id"]: w for w in call("workspace.list").get("workspaces", [])}
        if wid not in spaces:
            notify("Snooze", "No space to snooze here.")
            return 1
        agents = [p for p in call("pane.list").get("panes", []) if p.get("workspace_id") == wid and p.get("agent")]
        detail = "space · %d agent%s will be hidden" % (len(agents), "" if len(agents) == 1 else "s")
        env = {"HERDR_SNOOZE_KIND": "workspace", "HERDR_SNOOZE_TARGET": wid, "HERDR_SNOOZE_LABEL": spaces[wid].get("label") or wid, "HERDR_SNOOZE_DETAIL": detail}
        return open_picker(env, height)

    pane_id = context_pane_id(context)
    if pane_id in read_state()["panes"]:
        wake(config, pane_ids=[pane_id])  # the same key wakes it: one key, both ways
        return 0
    pane = next((p for p in call("pane.list").get("panes", []) if p["pane_id"] == pane_id), None)
    if pane is None:
        notify("Snooze", "No pane to snooze here.")
        return 1
    if not pane.get("agent"):
        notify("Snooze", "This pane has no agent, so there is nothing to hide.")
        return 1
    detail = " · ".join(part for part in (pane.get("agent"), context.get("workspace_label")) if part)
    tokens = pane.get("tokens") or {}
    env = {"HERDR_SNOOZE_KIND": "pane", "HERDR_SNOOZE_TARGET": pane_id, "HERDR_SNOOZE_LABEL": pane_label(pane), "HERDR_SNOOZE_DETAIL": detail,
           "HERDR_SNOOZE_AGENT": json.dumps(agent_identity(pane)), "HERDR_SNOOZE_STATUS": pane.get("agent_status") or "",
           "HERDR_SNOOZE_PR": str(tokens.get("pr") or "") if can_wait_for(WHEN_MERGED, pane) else ""}
    return open_picker(env, height + 2)


# ── CLI ──────────────────────────────────────────────────────────────────────

USAGE = """usage: herdr-snooze.py <command>
  action agent|workspace|manage|demo|wake
                                  what the herdr actions run
  picker [--demo]                 the popup itself
  tick [--force|--detected|--timer]  reconcile tokens and the agent view
  toggle                          Agents panel: priority -> grouped -> only snoozed, round again
  order                           Agents panel: priority <-> grouped, while anything is snoozed
  snooze <pane_id|workspace:ID> <duration|done|merged>
  wake --all | <pane_id|workspace:ID>...
  list"""


def _try_lock(handle):
    try:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except OSError:
        return False


def tick(args):
    """What every hook runs. Hooks fire in bursts (each focus change, each
    status flip, all at once: herdr runs them concurrently): a tick that
    finds another one running leaves a note and exits, and the running one
    goes again — a burst is a couple of passes, not a queue of processes each
    waiting on the lock and on herdr. Every pass reads everything from herdr,
    so plain ticks carry nothing a later pass would miss. Two run regardless:
    the startup --force (it resets what a restart left behind) and a
    --detected one, whose event (an agent leaving or arriving) no later pass
    could see.

    No note is ever stranded: the runner looks again after unlocking, and a
    tick that left a note tries the lock once more, so either the note's
    writer runs or the lock's holder will see the note after unlocking.

    A --timer tick is the detached sleeper's; if it fails (herdr busy or
    restarting), nothing else may come along to arm the next one, so it arms a
    retry itself while herdr's socket is there (_arm_retry)."""
    try:
        return _tick(args)
    except Exception:
        if "--timer" in args and os.path.exists(socket_path()):
            with contextlib.suppress(Exception):
                _arm_retry()
        raise


def _arm_retry():
    """After a failed --timer tick: a sleeper SAFETY_MS out, recorded as the
    sleeper so the next tick counts on it rather than starting another. Only
    in place of this tick's own (the sleeper exec'd into it, keeping its PID)
    or a dead one: a live sleeper another tick armed meanwhile is sooner or
    as good, and stays."""
    with locked_state() as state:
        if is_idle(state):
            return
        current = state.get("timer_pid")
        if current != os.getpid() and timer_alive(current) and is_our_timer(current):
            return
        pid = _spawn_timer(SAFETY_MS // 1000)
        state["timer"] = now_ms() + SAFETY_MS
        state["timer_pid"] = pid if isinstance(pid, int) else None


def _tick(args):
    root = state_dir()
    if "--detected" in args:
        received = now_ms()  # before any lock: agent_detected dates the event by it
        return _tick_once(args, detected=detected_event(hook_event()), received=received)
    if "--force" in args or not os.path.isdir(root):
        return _tick_once(args)
    pending = os.path.join(root, "tick.pending")
    with open(os.path.join(root, "tick.lock"), "a") as lock:
        while True:
            if not _try_lock(lock):
                with open(pending, "a"):
                    pass
                if not _try_lock(lock):
                    return 0  # its holder hasn't unlocked yet: it will see the note
            while True:
                with contextlib.suppress(FileNotFoundError):
                    os.remove(pending)
                _tick_once(args)
                if not os.path.exists(pending):
                    break
            fcntl.flock(lock, fcntl.LOCK_UN)
            if not os.path.exists(pending):
                return 0


def hook_event():
    try:
        return json.loads(os.environ.get("HERDR_PLUGIN_EVENT_JSON") or "null")
    except ValueError:
        return None


def _tick_once(args, detected=None, received=None):
    prune_stale_sessions()
    if os.path.exists(os.path.join(plugin_state_dir(), "snoozed.json")):
        recover_legacy(load_config())
    if is_idle(read_state()):
        # Nothing to do. If a file is there anyway (every entry in it was
        # malformed and dropped), remove it: while it exists, run.sh starts
        # Python on every focus change, forever.
        if os.path.exists(os.path.join(state_dir(), "snoozed.json")):
            with locked_state():
                pass
        return 0
    with locked_state() as state:
        if detected and agent_detected(state, detected, received):
            log("agent", "released" if detected.get("released") else "changed", "in", detected["pane_id"],
                "- its snooze was for the one before")
        sync(state, load_config(), force="--force" in args)
    return 0


def main(argv):
    if not argv:
        print(USAGE)
        return 2
    command, args = argv[0], argv[1:]

    if command == "action" and args:
        return run_action(args[0])
    if command == "picker":
        return run_picker(args)
    if command == "handoff" and len(args) == 1:
        try:
            ref = json.loads(args[0])
        except ValueError:
            return 2
        if not isinstance(ref, dict) or not ref.get("plugin_id") or not ref.get("entrypoint"):
            return 2
        params = {"plugin_id": ref["plugin_id"], "entrypoint": ref["entrypoint"], "placement": "popup", "focus": True, "env": ref.get("env") or {}}
        if ref.get("width"):
            params["width"] = int(ref["width"]) if str(ref["width"]).isdigit() else ref["width"]
        if ref.get("height"):
            params["height"] = int(ref["height"]) if str(ref["height"]).isdigit() else ref["height"]
        deadline = time.time() + 4
        while True:
            try:
                call("plugin.pane.open", params)
                return 0
            except HerdrError as error:
                if error.code != "ui_busy" or time.time() >= deadline:
                    notify("Snooze", "Couldn't open " + str(ref.get("plugin_id")) + ": " + str(error))
                    return 1
                time.sleep(0.06)

    if command == "tick":
        return tick(args)

    if command == "toggle":
        config = load_config()
        with locked_state() as state:
            view = state["view"]
            # One key walks the whole panel: herdr's two orders, then the
            # snoozed list. The orders are only ours to step through while
            # nobody else orders the panel (see `order`); otherwise it is
            # plain active <-> snoozed.
            own_order = not view.get("inherited") and not config["sort"]
            ring = (["priority", "spaces"] if own_order else ["active"]) + ["snoozed"]
            if view.get("showing") == "snoozed":
                here = "snoozed"
            else:
                here = (_mode_name(view.get("order")) or panel_mode()) if own_order else "active"
            there = ring[(ring.index(here) + 1) % len(ring)]
            if there == "snoozed" and state["panes"]:
                view["showing"] = "snoozed"
                view["from_pane"] = invocation_context().get("focused_pane_id") or focused_pane(
                    call("pane.list").get("panes", [])
                )
            else:
                view.pop("showing", None)
                view.pop("from_pane", None)
                if there in PANEL_MODES:
                    view["order"] = there
            if state["panes"]:
                sync(state, config)
            view = state["view"]
            if not view.get("applied"):
                # Nothing was snoozed, or the last deadline had passed and
                # this very sync cleared it. A key press that does nothing
                # needs a reason.
                notify("Snooze", "Nothing is snoozed.")
            log("toggle: showing", "snoozed" if view.get("showing") == "snoozed" else there)
        return 0

    if command == "order":
        config = load_config()
        with locked_state() as state:
            view = state["view"]
            if not state["panes"]:
                notify("Snooze", "Nothing is snoozed: click the panel's label to switch its order.")
                return 0
            if view.get("inherited"):
                notify("Snooze", "The panel's order belongs to %s." % (view["inherited"].get("source") or "another plugin"))
                return 0
            if config["sort"]:
                notify("Snooze", "config.json pins the panel's order (\"sort\").")
                return 0
            mode = panel_mode()
            current = _mode_name(view.get("order")) or mode
            view["order"] = "spaces" if current == "priority" else "priority"
            sync(state, config)
            flipped = state["view"].get("order")
            if not state["view"].get("applied"):
                notify("Snooze", "Nothing is snoozed: click the panel's label to switch its order.")
            log("order:", flipped or mode, "(herdr's own: %s)" % mode)
        return 0

    if command == "snooze" and len(args) == 2:
        kind, target = ("workspace", args[0].split(":", 1)[1]) if args[0].startswith("workspace:") else ("pane", args[0])
        if args[1] in (WHEN_DONE, WHEN_MERGED):
            if kind != "pane":
                print("snooze: conditions apply to panes, not spaces", file=sys.stderr)
                return 2
            until = condition_cap(datetime.now())
            covered = snooze(kind, target, until, load_config(), when=args[1])
        else:
            until = parse_until(args[1])
            covered = snooze(kind, target, until, load_config())
        log("snoozed %s %s (%d pane(s)) until %s" % (kind, target, covered, until.strftime("%Y-%m-%d %H:%M:%S")))
        return 0 if covered else 1

    if command == "wake" and args:
        everything = "--all" in args
        targets = [a for a in args if a != "--all"]
        woken = wake(
            load_config(),
            pane_ids=[t for t in targets if not t.startswith("workspace:")],
            workspace_ids=[t.split(":", 1)[1] for t in targets if t.startswith("workspace:")],
            everything=everything,
        )
        log("woke %d pane(s)" % woken)
        return 0

    if command == "list":
        state, now = read_state(), now_ms()
        for wid, space in sorted(state["workspaces"].items()):
            print("workspace:%s\t%s left\tuntil %s" % (wid, format_left(space["until"] - now), from_ms(space["until"]).strftime("%Y-%m-%d %H:%M")))
        for pid, entry in sorted(state["panes"].items()):
            print("%s\t%s left\tuntil %s\t(%s)" % (pid, format_left(entry["until"] - now), from_ms(entry["until"]).strftime("%Y-%m-%d %H:%M"), entry.get("via")))
        for pid, entry in sorted(state.get("woke", {}).items()):
            print("%s\tjust woke\t%s\t(%s)" % (pid, format_until(from_ms(entry.get("at", now)), from_ms(now)), entry.get("reason") or "time"))
        if is_idle(state):
            print("nothing snoozed")
        return 0

    print(USAGE)
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except ValueError as problem:
        print("snooze:", problem, file=sys.stderr)
        sys.exit(2)
    except (OSError, HerdrError) as problem:
        print("snooze: herdr call failed:", problem, file=sys.stderr)
        sys.exit(1)
