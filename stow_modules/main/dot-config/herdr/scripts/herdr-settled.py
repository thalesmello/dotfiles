#!/usr/bin/env python3
"""Settled: an archive of closed Herdr agent sessions, T3 Code style.

In T3 Code the sidebar is an inbox: a thread you are done with gets settled,
not deleted, and settled threads wait in a section at the bottom until you
want one back. Herdr has no such thing -- a closed pane vanishes from
`pane.list`, and with it every trace the sidebar could show.

This script is the missing archive, in three parts:

  tick     (plugin hooks: pane.closed, pane.agent_status_changed, startup)
           Diff the agent-sessions store (`herdr-preset track-agent-sessions`,
           which records every live agent's conversation, cwd and launch argv)
           against the panes herdr still has. A recorded conversation with no
           live pane is settled. Any session that is closed is therefore
           settled, automatically. While panes are live, tick also remembers
           their titles, so a settled entry keeps the name it had on screen.

  picker   (prefix+alt+s, a popup) Every section in one list -- Pinned,
           Blocked, Working, Done, Active, Snoozed (all live), then Settled.
           Selecting a settled row previews its last few messages read from
           the TAIL of its transcript: no agent is started and no recap is
           generated to look at a closed session. Enter reopens it.

  reopen   A settled conversation in a NEW tab, in the workspace it was
           recorded in (recreated under the same label if it is gone), by
           replaying its recorded launch argv with the session flag swapped
           for the recorded conversation -- the same trick as
           `herdr-preset resume-agent`, ported below because resume-agent
           resolves by live pane and a settled session has none.

State: one JSON file per herdr session under the plugin state dir,
{"settled": {<conversation>: {...}}, "seen": {<conversation>: {...}}}.
Keyed by conversation (transcript path or session id), never by pane id:
herdr recycles pane ids and renumbers them across restarts. Nothing is ever
pruned automatically; the viewer's backspace (forget) is the only way an entry
leaves, and it never touches the transcript file.

Python 3.11+, standard library only.
"""

import contextlib
import glob
import json
import os
import re
import shlex
import socket
import subprocess
import sys
import threading
import time

PLUGIN_ID = os.environ.get("HERDR_PLUGIN_ID") or "herdr-settled"
SOURCE = "plugin:" + PLUGIN_ID

# Group order in the viewer (decided 2026-11-04): what needs you first, what
# is finished next, then idle, then working (out of your face, T3-style),
# then the put-away buckets. Pinned floats above all of it, as in the sidebar.
SECTIONS = ["Pinned", "Blocked", "Done", "Idle", "Working", "Snoozed", "Settled"]
STATUS_SECTION = {"blocked": "Blocked", "working": "Working", "done": "Done"}
TAIL_BYTES = 256 * 1024
PREVIEW_MESSAGES = 3
SNOOZE_DEFAULT = "1h"


# ── paths ────────────────────────────────────────────────────────────────────


def socket_path():
    if os.environ.get("HERDR_SOCKET_PATH"):
        return os.environ["HERDR_SOCKET_PATH"]
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")
    return os.path.join(base, "herdr", "herdr.sock")


def session_name():
    """The herdr session's name, read off the socket path like herdr-preset:
    the default session's socket sits in the config dir, a named one under
    sessions/<name>/."""
    directory = os.path.dirname(os.path.realpath(socket_path()))
    if os.path.basename(os.path.dirname(directory)) == "sessions":
        return os.path.basename(directory)
    return "default"


def state_dir():
    return (
        os.environ.get("SETTLED_STATE_DIR")
        or os.environ.get("HERDR_PLUGIN_STATE_DIR")
        or os.path.join(
            os.environ.get("XDG_STATE_HOME") or os.path.join(os.path.expanduser("~"), ".local", "state"),
            "herdr", "plugins", PLUGIN_ID,
        )
    )


def registry_path():
    return os.path.join(state_dir(), session_name() + ".json")


def agent_sessions_path():
    if os.environ.get("SETTLED_AGENT_SESSIONS"):
        return os.environ["SETTLED_AGENT_SESSIONS"]
    base = os.environ.get("XDG_STATE_HOME") or os.path.join(os.path.expanduser("~"), ".local", "state")
    return os.path.join(base, "herdr", "agent-sessions", session_name() + ".json")


def sibling(name):
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), name)


# ── herdr socket ─────────────────────────────────────────────────────────────


class HerdrError(Exception):
    def __init__(self, code, message):
        super().__init__("%s: %s" % (code, message))
        self.code = code


def call(method, params=None, timeout=5.0):
    """One request per connection: the server answers a line and hangs up."""
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        sock.connect(socket_path())
        sock.sendall((json.dumps({"id": "settled", "method": method, "params": params or {}}) + "\n").encode("utf-8"))
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
    print(*parts, flush=True)


# ── state ────────────────────────────────────────────────────────────────────


def read_registry():
    try:
        with open(registry_path(), encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return {"settled": {}, "seen": {}}
    if not isinstance(data, dict):
        return {"settled": {}, "seen": {}}
    settled = data.get("settled") if isinstance(data.get("settled"), dict) else {}
    seen = data.get("seen") if isinstance(data.get("seen"), dict) else {}
    return {"settled": settled, "seen": seen}


def write_registry(state):
    path = registry_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = "%s.%d.tmp" % (path, os.getpid())
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(state, handle, indent=1, sort_keys=True)
    os.replace(tmp, path)


def read_store():
    """The agent-sessions store: {"panes": {pane_id: {agent, cwd, session,
    identity, argv, updated}}}. Read-only here; herdr-preset owns it."""
    try:
        with open(agent_sessions_path(), encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return {}
    panes = data.get("panes") if isinstance(data, dict) else None
    return panes if isinstance(panes, dict) else {}


# ── conversations ────────────────────────────────────────────────────────────


def conversation_of(session):
    """A conversation's durable key: its transcript path or session id."""
    if isinstance(session, dict):
        value = session.get("value")
        if isinstance(value, str) and value:
            return value
    return None


def pane_conversation(pane):
    return conversation_of(pane.get("agent_session"))


def transcript_path(entry):
    """Where the conversation's transcript lives, if it can be found without
    starting anything. kind=path names it directly; kind=id is looked up in
    each agent's own session directory."""
    session = entry.get("session") or {}
    value = session.get("value") or ""
    agent = entry.get("agent") or ""
    home = os.path.expanduser("~")
    if session.get("kind") == "path" and value:
        return value
    if not value:
        return None
    if agent == "claude":
        matches = glob.glob(os.path.join(home, ".claude", "projects", "*", value + ".jsonl"))
    elif agent == "codex":
        matches = glob.glob(os.path.join(home, ".codex", "sessions", "*", "*", "*", "rollout-*-" + value + ".jsonl"))
    elif agent == "pi":
        matches = glob.glob(os.path.join(home, ".pi", "agent", "sessions", "*", "*" + value + "*.jsonl"))
    else:
        matches = []
    return matches[0] if matches else None


# ── tail reading ─────────────────────────────────────────────────────────────


def spoken_text(message):
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(str(b.get("text") or "") for b in content if isinstance(b, dict) and b.get("type") == "text")
    return ""


def _message_of(entry):
    """The {role, text} of one transcript line, across Pi/Claude/Codex JSONL
    shapes (the same three herdr-recap's transcript_conversation handles)."""
    message = None
    if entry.get("type") == "message" and isinstance(entry.get("message"), dict):
        message = entry["message"]
    elif isinstance(entry.get("message"), dict):
        message = entry["message"]
    elif isinstance(entry.get("payload"), dict) and entry["payload"].get("type") == "message":
        message = entry["payload"]
    if not message:
        return None
    role = str(message.get("role") or "").lower()
    if role not in ("user", "assistant") or entry.get("isMeta") or entry.get("isSidechain"):
        return None
    text = spoken_text(message).strip()
    return (role, text) if text else None


def tail_messages(path, count=PREVIEW_MESSAGES, tail_bytes=TAIL_BYTES):
    """The last `count` spoken messages of a transcript, from a bounded tail
    read: seek near the end, drop the (probably partial) first line, parse
    what remains. Never reads the whole file, never starts the agent."""
    if not path or not os.path.isfile(path):
        return []
    try:
        with open(path, "rb") as handle:
            handle.seek(0, os.SEEK_END)
            size = handle.tell()
            handle.seek(max(0, size - tail_bytes))
            data = handle.read().decode("utf-8", "replace")
    except OSError:
        return []
    lines = data.splitlines()
    if size > tail_bytes and lines:
        lines = lines[1:]  # the first line was cut in half by the seek
    messages = []
    for line in lines:
        if '"role"' not in line and '"message"' not in line:
            continue
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if isinstance(entry, dict):
            found = _message_of(entry)
            if found:
                messages.append(found)
    return messages[-count:]


def transcript_title(path):
    """A Pi session's own name from its session_info lines. Pi appends a
    fresh session_info whenever the session is named or renamed, so the
    title lives anywhere in the file and the LATEST one wins -- scan the
    whole transcript (only session_info lines are parsed), mirroring
    restore-agent-titles.py's latest_pi_title."""
    if not path or not os.path.isfile(path):
        return ""
    title = ""
    try:
        with open(path, "rb") as handle:
            for line in handle:
                if b'"session_info"' not in line:
                    continue
                try:
                    entry = json.loads(line)
                except ValueError:
                    continue
                if entry.get("type") == "session_info" and isinstance(entry.get("name"), str):
                    if entry["name"].strip():
                        title = entry["name"].strip()
    except OSError:
        return ""
    return title


# ── capture (tick) ───────────────────────────────────────────────────────────


def entry_from_record(pane_id, record, seen, now):
    session = record.get("session") or {}
    identity = record.get("identity") or {}
    entry = {
        "agent": record.get("agent") or "",
        "cwd": record.get("cwd") or "",
        "session": session if isinstance(session, dict) else {},
        "argv": record.get("argv") or [],
        "pane_id": pane_id,
        "workspace_id": identity.get("workspace_id") or "",
        "workspace_label": identity.get("workspace_label") or "",
        "tab_id": identity.get("tab_id") or "",
        "tab_label": identity.get("tab_label") or "",
        "title": "",
        "settled_at": now,
        "last_status": "",
    }
    remembered = seen.get(conversation_of(session)) or {}
    entry["title"] = remembered.get("title") or ""
    if not entry["title"]:
        entry["title"] = transcript_title(transcript_path(entry))
    if not entry["title"]:
        entry["title"] = entry["tab_label"] or entry["workspace_label"] or os.path.basename(entry["cwd"]) or entry["agent"]
    return entry


def capture(state, store, live_panes, workspaces, now):
    """Fold the world into the registry. Pure: callers do the IO.

    - a live pane's conversation is remembered in `seen` (title, labels);
    - a stored conversation with no live pane becomes (or stays) settled,
      keeping its original settled_at;
    - a settled conversation that is live again is reopened: it leaves.
    """
    labels = {w.get("workspace_id"): w.get("label") or "" for w in workspaces}
    live_ids = set()
    live_convs = set()
    # Seed from the remembered titles: on the pane.closed tick the pane is
    # already gone from live_panes, and rebuilding `seen` from live panes
    # alone would discard its title at the one moment entry_from_record
    # needs it, falling back to the tab label. Live panes overlay below.
    seen = dict(state.get("seen") or {})
    for pane in live_panes:
        live_ids.add(pane.get("pane_id"))
        conv = pane_conversation(pane)
        if not pane.get("agent") or not conv:
            continue
        live_convs.add(conv)
        seen[conv] = {
            "title": pane.get("terminal_title_stripped") or pane.get("terminal_title") or "",
            "workspace_label": labels.get(pane.get("workspace_id"), ""),
            "tab_label": "",
        }
    settled = {}
    for key, entry in (state.get("settled") or {}).items():
        if key not in live_convs:
            settled[key] = entry
    for pane_id, record in store.items():
        if not isinstance(record, dict) or not record.get("agent"):
            continue
        conv = conversation_of(record.get("session"))
        key = conv or ("pane:" + pane_id)
        if pane_id in live_ids or (conv and conv in live_convs):
            continue
        if key in settled:
            continue  # already settled: the first capture froze it
        settled[key] = entry_from_record(pane_id, record, seen, now)
    # Prune remembered titles to conversations that are live, settled, or
    # still recorded in the store, so `seen` cannot grow without bound now
    # that it survives pane closes.
    keep = live_convs | set(settled)
    for record in store.values():
        if isinstance(record, dict):
            conv = conversation_of(record.get("session"))
            if conv:
                keep.add(conv)
    seen = {conv: info for conv, info in seen.items() if conv in keep}
    return {"settled": settled, "seen": seen}


def tick():
    try:
        panes = call("pane.list").get("panes", [])
        workspaces = call("workspace.list").get("workspaces", [])
    except (OSError, ValueError, HerdrError) as problem:
        log("tick: herdr unreachable:", problem)
        return 1
    before = read_registry()
    state = capture(before, read_store(), panes, workspaces, time.time())
    if state != before:  # hooks fire on every status flip; don't churn the file
        write_registry(state)
    return 0


# ── resume command ───────────────────────────────────────────────────────────
# Ported from `herdr-preset resume-agent` (bin/herdr-preset), which resolves a
# conversation by live pane. A settled session has no pane, so the flag-swap
# runs here against the frozen registry record instead. Keep the two in step.
#
# One deliberate addition over a plain flag-swap: the recorded argv often
# carries the session's FIRST prompt (`pi --session-id <id> -- 'do X'`,
# `claude 'do X'`). Replaying it verbatim would send that prompt again as a
# new message on resume. So the swap also strips the prompt: everything
# after `--`, bare positional tokens, and claude's -p/--print (print mode
# would run one-shot and exit). A bare token right after a kept flag is
# kept -- it is that flag's value (--effort high), not a prompt -- unless
# the flag is a known boolean.

_RESUME_SPEC = {
    "claude": {
        "bin": "claude",
        "resume": lambda v: ["--resume", v],
        "fallback": ["--continue"],
        "drop_value": {"--session-id"},
        "drop_opt": {"--resume", "-r", "-p", "--print"},
        "drop_bool": {"--continue", "-c", "--fork-session"},
        "keep_value": {"--model", "--agents", "--append-system-prompt", "--settings",
                       "--permission-mode", "--add-dir", "--mcp-config"},
        "bool_flags": {"--verbose", "--ide", "--strict-mcp-config", "--brief",
                       "--dangerously-skip-permissions", "--disable-slash-commands",
                       "--allow-dangerously-skip-permissions"},
        "subcommand": None,
    },
    "codex": {
        "bin": "codex",
        "resume": lambda v: ["resume", v],
        "fallback": ["resume", "--last"],
        "drop_value": set(),
        "drop_opt": set(),
        "drop_bool": set(),
        "keep_value": {"-c", "--config", "-m", "--model", "-p", "--profile",
                       "-s", "--sandbox", "-a", "--ask-for-approval", "-i",
                       "--image", "-C", "--cd", "--add-dir"},
        "bool_flags": {"--full-auto", "--dangerously-bypass-approvals-and-sandbox", "--oss", "--search"},
        "subcommand": "resume",
    },
    "pi": {
        "bin": "pi",
        "resume": lambda v: ["--session", v],
        "fallback": ["--continue"],
        "drop_value": {"--session", "--session-id", "--fork"},
        "drop_opt": {"--resume", "-r"},
        "drop_bool": {"--continue", "-c", "--no-session"},
        "keep_value": {"--model", "-m", "--name", "-n", "--system", "--tools",
                       "--session-dir", "--meta-agent-role", "--startup-context-mode"},
        "bool_flags": {"--verbose", "--quiet"},
        "subcommand": None,
    },
}


def resume_command(entry):
    """The shell command that puts a settled conversation back in an agent:
    the recorded launch argv with its old session selection removed and the
    recorded conversation put in its place. None for an unknown agent kind."""
    agent = entry.get("agent") or ""
    spec = _RESUME_SPEC.get(agent)
    if spec is None:
        return None
    value = conversation_of(entry.get("session"))
    launch = entry.get("argv") or []

    def flag(tok):
        return tok.split("=", 1)[0]

    def selected(tok):
        if tok is None or tok.startswith("-"):
            return None
        return tok

    def is_bool_flag(tok):
        return tok.startswith("--no-") or tok in spec.get("bool_flags", set())

    kept = []
    prior = None
    rest = launch[1:] if launch else []
    i = 0
    while i < len(rest):
        tok, f = rest[i], flag(rest[i])
        inline = "=" in tok and tok.startswith("-")
        if tok == "--":
            break  # everything after `--` is the prompt
        if f in spec["drop_value"] or f in spec["drop_opt"]:
            if inline:
                if f in ("--resume", "-r"):
                    prior = selected(tok.split("=", 1)[1]) or prior
                i += 1
            elif i + 1 < len(rest) and (f in spec["drop_value"] or not rest[i + 1].startswith("-")):
                if f in ("--resume", "-r", "--session", "--session-id"):
                    prior = selected(rest[i + 1]) or prior
                i += 2
            else:
                i += 1
        elif f in spec["drop_bool"]:
            i += 1
        elif spec["subcommand"] and tok == spec["subcommand"]:
            if i + 1 < len(rest):
                prior = selected(rest[i + 1]) or prior
            break
        elif f in spec["keep_value"] and not inline:
            kept += rest[i:i + 2]
            i += 2
        elif not tok.startswith("-"):
            # A bare positional. It is a prompt -- unless the previous kept
            # token is a flag still waiting for its value (--effort high).
            prev = kept[-1] if kept else None
            if prev is not None and prev.startswith("-") and "=" not in prev and not is_bool_flag(prev):
                kept.append(tok)
            i += 1
        else:
            kept.append(tok)
            i += 1

    argv0 = launch[0] if launch else spec["bin"]
    base = argv0.rsplit("/", 1)[-1]
    if base in (agent, agent + ".real", spec["bin"], spec["bin"] + ".real"):
        argv0 = spec["bin"]
    tail = spec["resume"](value or prior) if (value or prior) else spec["fallback"]
    return shlex.join([argv0] + kept + tail)


def is_fallback(entry):
    """Whether reopening would have to guess ('most recent in this cwd')
    because no conversation was ever recorded for the session."""
    return conversation_of(entry.get("session")) is None


# ── reopen / settle / forget ─────────────────────────────────────────────────


def reopen(key):
    """Enter on a settled row. Returns a human outcome string."""
    state = read_registry()
    entry = (state.get("settled") or {}).get(key)
    if entry is None:
        return "not settled anymore"
    panes = call("pane.list").get("panes", [])
    for pane in panes:
        if pane_conversation(pane) == key:
            call("agent.focus", {"target": pane["pane_id"]})
            return "already open in %s -- jumped there" % pane["pane_id"]
    command = resume_command(entry)
    if command is None:
        return "no resume command known for agent %r" % (entry.get("agent") or "")
    workspaces = call("workspace.list").get("workspaces", [])
    workspace_id = None
    for space in workspaces:
        if space.get("workspace_id") == entry.get("workspace_id"):
            workspace_id = space["workspace_id"]
            break
    if workspace_id is None and entry.get("workspace_label"):
        for space in workspaces:
            if space.get("label") == entry["workspace_label"]:
                workspace_id = space["workspace_id"]
                break
    cwd = entry.get("cwd") or ""
    if not os.path.isdir(cwd):
        cwd = os.path.expanduser("~")
    if workspace_id is None:
        created = call("workspace.create", {"label": entry.get("workspace_label") or "settled", "cwd": cwd, "focus": False})
        workspace_id = (created.get("workspace") or {}).get("workspace_id")
        if workspace_id is None:
            return "could not create workspace %r" % (entry.get("workspace_label") or "")
    tab = call("tab.create", {"workspace_id": workspace_id, "cwd": cwd, "label": entry.get("title") or entry.get("tab_label") or "settled", "focus": True})
    root = tab.get("root_pane") or tab.get("pane") or {}
    pane_id = root.get("pane_id")
    if not pane_id:
        return "new tab made, but no root pane to run in"
    # There is no pane.run on the socket; the CLI's `pane run` is send_text
    # plus an enter, so reopen does the same two calls.
    call("pane.send_text", {"pane_id": pane_id, "text": command})
    call("pane.send_keys", {"pane_id": pane_id, "keys": ["enter"]})
    state["settled"].pop(key, None)
    write_registry(state)
    return "reopened in %s" % pane_id


def settle_pane(pane_id):
    """Explicitly settle a live agent (the T3 checkbox): freeze it into the
    registry, then close its pane. The close fires the pane.closed hook, whose
    tick would capture the same conversation -- capture is idempotent, so the
    entry this writes is the one that stays."""
    panes = call("pane.list").get("panes", [])
    pane = next((p for p in panes if p.get("pane_id") == pane_id), None)
    if pane is None:
        return "no such pane"
    if not pane.get("agent"):
        return "that pane has no agent to settle"
    workspaces = call("workspace.list").get("workspaces", [])
    store = read_store()
    state = capture(read_registry(), store, panes, workspaces, time.time())
    conv = pane_conversation(pane)
    key = conv or ("pane:" + pane_id)
    if key not in state["settled"]:
        # Not in the store yet (agent-sessions has not swept it): freeze from
        # the live pane directly.
        record = {
            "agent": pane.get("agent"), "cwd": pane.get("cwd"), "argv": [],
            "session": pane.get("agent_session") or {},
            "identity": {"workspace_id": pane.get("workspace_id"), "tab_id": pane.get("tab_id")},
        }
        state["settled"][key] = entry_from_record(pane_id, record, state.get("seen") or {}, time.time())
    write_registry(state)
    call("pane.close", {"pane_id": pane_id})
    return "settled %s" % (state["settled"][key].get("title") or key)


def forget(key):
    state = read_registry()
    if key in (state.get("settled") or {}):
        del state["settled"][key]
        write_registry(state)
        return "forgot %s" % key
    return "not in the settled registry"


def last_settled_key(state=None):
    settled = (state or read_registry()).get("settled") or {}
    if not settled:
        return None
    return max(settled, key=lambda k: settled[k].get("settled_at") or 0)


# ── filters ──────────────────────────────────────────────────────────────────
# Tab/Shift+Tab cycle these; Shift+A/P/S/W/D/Z jump straight to one (S = settled, Z = snoozed). doneidle
# is a single filter over the Done and Idle groups (T3's "finished or
# waiting, I don't care which" bucket).
FILTERS = [("all", "All"), ("pinned", "Pinned"), ("blocked", "Blocked"),
           ("doneidle", "Done / Idle"), ("working", "Working"),
           ("snoozed", "Snoozed"), ("settled", "Settled")]
FILTER_SECTIONS = {
    "all": None,
    "pinned": {"Pinned"},
    "blocked": {"Blocked"},
    "doneidle": {"Done", "Idle"},
    "working": {"Working"},
    "snoozed": {"Snoozed"},
    "settled": {"Settled"},
}
FILTER_KEYS = {"A": "all", "P": "pinned", "S": "settled", "W": "working", "D": "doneidle", "Z": "snoozed"}


def visible_sections(sections, filter_name="all", query=""):
    """The sections the viewer shows under a filter + search query. A row
    matches the query when the text appears in its title, detail, agent,
    pane/conversation id, or transcript path."""
    allowed = FILTER_SECTIONS.get(filter_name)
    needle = (query or "").strip().lower()
    out = []
    for name, rows in sections:
        if allowed is not None and name not in allowed:
            continue
        kept = []
        for row in rows:
            # `_search` is the row's precomputed haystack (build_rows): the
            # join+lower per row per keystroke was the whole cost of search.
            if needle and needle not in (row.get("_search") or _row_haystack(row)):
                continue
            kept.append(row)
        if kept:
            out.append((name, kept))
    return out


def _row_haystack(row):
    return " ".join(str(row.get(k) or "") for k in ("title", "detail", "kind", "pane_id", "key", "transcript")).lower()


class FilterWorker:
    """Search/filter computation on a background thread, never the UI's.

    Coalescing: a new request replaces any job still queued, so typing
    `horse` runs at most the latest prefix instead of five stale filters.
    The UI thread submits, keeps rendering the previous result, and polls
    while it waits for keys (RawTerminal.key with a timeout).

    A thread, not a process pool, on purpose: filtering the real registry
    (46 rows) measures 0.08 ms, 4,600 rows 7.7 ms before the precomputed
    haystacks; one ProcessPoolExecutor submit (pickle + IPC + fork amortised)
    costs more than the whole job at this scale, per keystroke. True
    parallelism would be slower. The GIL is not a problem here: the UI
    thread spends its life blocked in select/read, which releases it."""

    def __init__(self):
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._job = None
        self._result = None
        self._gen = 0
        self._closed = False
        self._thread = threading.Thread(target=self._run, name="settled-filter", daemon=True)
        self._thread.start()

    def request(self, sections, filter_name, query):
        with self._lock:
            self._gen += 1
            self._job = (self._gen, sections, filter_name, query)
            gen = self._gen
        self._wake.set()
        return gen

    def _run(self):
        while True:
            self._wake.wait()
            self._wake.clear()
            with self._lock:
                job, self._job = self._job, None
                closed = self._closed
            if closed:
                return
            if job is None:
                continue
            gen, sections, filter_name, query = job
            result = visible_sections(sections, filter_name, query)
            with self._lock:
                self._result = (gen, result)

    def poll(self):
        """The newest finished (generation, display sections), or None."""
        with self._lock:
            return self._result

    def close(self):
        with self._lock:
            self._closed = True
        self._wake.set()


# ── viewer rows ──────────────────────────────────────────────────────────────


def live_section(pane):
    tokens = pane.get("tokens") or {}
    if "herdr_snooze" in tokens:
        return "Snoozed"
    if tokens.get("um_pin"):
        return "Pinned"
    return STATUS_SECTION.get(pane.get("agent_status") or "", "Idle")


def build_rows(live_panes, workspaces, settled):
    """The viewer's display list: (section, [row, ...]) in SECTIONS order.
    A row is a dict the picker renders and acts on; settled rows carry their
    registry `key`, live rows their `pane_id`."""
    labels = {w.get("workspace_id"): w.get("label") or "" for w in workspaces}
    grouped = {name: [] for name in SECTIONS}
    for pane in live_panes:
        if not pane.get("agent"):
            continue
        tokens = pane.get("tokens") or {}
        row = {
            "kind": "live",
            "pane_id": pane["pane_id"],
            "title": pane.get("terminal_title_stripped") or pane.get("terminal_title") or pane.get("agent") or pane["pane_id"],
            "detail": " · ".join(x for x in (pane.get("agent") or "", labels.get(pane.get("workspace_id"), "")) if x),
            # Fixed right-hand columns, drawn by the picker (see AGENT_COL &c).
            "agent_name": pane.get("agent") or "",
            "workspace_label": labels.get(pane.get("workspace_id"), ""),
            "age": "",
            "status": pane.get("agent_status") or "",
            "snoozed": "herdr_snooze" in tokens,
            "pinned": bool(tokens.get("um_pin")),
        }
        row["_search"] = _row_haystack(row)
        grouped[live_section(pane)].append(row)
    for key, entry in settled.items():
        path = transcript_path(entry)
        row = {
            "kind": "settled",
            "key": key,
            "title": entry.get("title") or entry.get("agent") or key,
            "detail": " · ".join(x for x in (entry.get("agent") or "", entry.get("workspace_label") or "", _age(entry.get("settled_at"))) if x),
            "agent_name": entry.get("agent") or "",
            "workspace_label": entry.get("workspace_label") or "",
            "age": _age(entry.get("settled_at")),
            "cwd": entry.get("cwd") or "",
            "status": "",
            "transcript": path,
            "gone": bool(path) and not os.path.isfile(path),
            "fallback": is_fallback(entry),
            "settled_at": entry.get("settled_at") or 0,
        }
        row["_search"] = _row_haystack(row) + " " + str(entry.get("cwd") or "").lower()
        grouped["Settled"].append(row)
    grouped["Settled"].sort(key=lambda row: row["settled_at"], reverse=True)
    return [(name, grouped[name]) for name in SECTIONS if grouped[name]]


def _age(settled_at):
    if not settled_at:
        return ""
    seconds = max(0, int(time.time() - settled_at))
    if seconds < 3600:
        return "%dm ago" % max(1, seconds // 60)
    if seconds < 86400:
        return "%dh ago" % (seconds // 3600)
    return "%dd ago" % (seconds // 86400)


# ── TUI (the popup) ──────────────────────────────────────────────────────────

BOLD, DIM, REVERSE, RESET = "\x1b[1m", "\x1b[2m", "\x1b[7m", "\x1b[0m"
# Marked (multi-selected) rows: a mauve wash over the whole row, dark text
# on it -- a background, not a glyph in the margin (catppuccin mauve #ca9ee6,
# the same accent config.toml gives the pin token).
MARK_BG = "\x1b[48;2;202;158;230m\x1b[38;2;48;52;70m"
_KEYS = {
    b"\x1b[A": "up", b"\x1bOA": "up", b"k": "up", b"\x10": "up",
    b"\x1b[B": "down", b"\x1bOB": "down", b"j": "down", b"\x0e": "down",
    b"\x1b[5~": "pgup", b"\x1b[6~": "pgdn", b"\x1b[H": "home", b"\x1b[F": "end",
    b"\x1b[1~": "home", b"\x1b[4~": "end",
    b"\r": "enter", b"\n": "enter",
    b"\x1b": "esc", b"\x03": "esc", b"q": "esc",
    b"\x7f": "backspace", b"\x08": "backspace",
    b" ": "space", b"\t": "tab", b"\x1b[Z": "shift-tab",
}


def decode_key(data):
    return ("eof", b"") if not data else (_KEYS.get(data, "char"), data)


_SEQUENCES = sorted((seq for seq in _KEYS if len(seq) > 1), key=len, reverse=True)


def split_keys(data):
    keys = []
    while data:
        known = next((seq for seq in _SEQUENCES if data.startswith(seq)), None)
        if known:
            size = len(known)
        elif data[:1] == b"\x1b" and len(data) > 1:
            size = len(data)
        else:
            lead = data[0]
            size = 1 if lead < 0xC0 else 2 if lead < 0xE0 else 3 if lead < 0xF0 else 4
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
            size = os.get_terminal_size(self.fd)
            self.cols, self.rows = size.columns, size.lines
        except OSError:
            self.rows, self.cols = 24, 80
        sys.stdout.write("\x1b[?25l")
        return self

    def __exit__(self, *exc):
        import termios

        termios.tcsetattr(self.fd, termios.TCSADRAIN, self.saved)
        sys.stdout.write("\x1b[?25h\x1b[2J\x1b[H")
        sys.stdout.flush()

    def _fill(self):
        data = os.read(self.fd, 64)
        if data == b"\x1b":
            import select

            if select.select([self.fd], [], [], 0.05)[0]:
                data += os.read(self.fd, 64)
        self.pending = split_keys(data) or [b""]

    def key(self, timeout=None):
        """Next key, or (None, b'') after `timeout` seconds with no input
        (the picker uses that to poll the filter worker)."""
        if not self.pending and timeout is not None:
            import select

            if not select.select([self.fd], [], [], timeout)[0]:
                return (None, b"")
        if not self.pending:
            self._fill()
        return decode_key(self.pending.pop(0))

    def peek_key(self):
        """The next key without consuming it, or None if no input is ready.
        Holding a key down auto-repeats: the picker peeks to coalesce a burst
        of repeats into one move and one draw, instead of redrawing per
        repeat and processing a stale queue after the key is released."""
        if not self.pending:
            import select

            if not select.select([self.fd], [], [], 0)[0]:
                return None
            self._fill()
        return decode_key(self.pending[0])

    def draw(self, lines):
        # Home + overwrite + clear-to-EOL, not ESC[2J: a full clear makes the
        # outer terminal repaint the whole popup every frame, which is most
        # of the cost of a frame at key-repeat rates.
        sys.stdout.write("\x1b[H" + "\r\n".join(line + "\x1b[K" for line in lines) + "\x1b[J")
        sys.stdout.flush()


def clip(text, width):
    text = " ".join(str(text or "").split())
    return text if len(text) <= width else text[: max(0, width - 1)] + "…"


_ANSI = re.compile(r"\x1b\[[0-9;]*[a-zA-Z]")


def pad_visible(text, width):
    """Pad with spaces to a visible width, ignoring ANSI escapes (for the
    cheatsheet sidebar's column edge)."""
    visible = len(_ANSI.sub("", text))
    return text + " " * max(0, width - visible)


def _sibling_script(name, args):
    try:
        out = subprocess.run([sys.executable, sibling(name)] + args, capture_output=True, text=True, timeout=20)
        return (out.stdout or out.stderr or "").strip().splitlines()
    except (OSError, subprocess.SubprocessError) as problem:
        return [str(problem)]


class Picker:
    def __init__(self):
        self.selected = 0
        self.marked = set()       # pane_ids / settled keys, for bulk actions
        self.flash = ""
        self.preview_cache = {}   # (path, size, mtime) -> [(role, text)]
        self.handoff_snooze = False
        # Settled is the default view: live agents are already visible in
        # herdr's own Agents panel, so this window opens on the archive.
        self.filter = "settled"
        self.query = ""
        self.searching = False
        self.confirm = None  # {"pane_ids": [...], "label": str} while a settle waits for y/n
        self.show_help = False  # cheatsheet sidebar, toggled by ?
        self.sections = []
        self.display_sections = []
        self.rows = []
        self.worker = FilterWorker()
        self._filter_gen = 0
        self._applied_gen = 0
        self._filter_reason = ""
        self.reload()

    def close(self):
        if getattr(self, "worker", None) is not None:
            self.worker.close()
            self.worker = None

    def reload(self):
        panes = call("pane.list").get("panes", [])
        workspaces = call("workspace.list").get("workspaces", [])
        state = read_registry()
        self.sections = build_rows(panes, workspaces, state.get("settled") or {})
        if self.filter == "all" and not self.query:
            self.display_sections = self.sections
            self.rows = [row for _name, rows in self.sections for row in rows]
            self.selected = min(self.selected, max(0, len(self.rows) - 1))
        else:
            self.request_filter("reload")

    def apply_view(self):
        """Synchronous filtering; only for tests and worker-less fallbacks.
        The live picker always goes through request_filter/poll_filter."""
        self.display_sections = visible_sections(self.sections, self.filter, self.query)
        self.rows = [row for _name, rows in self.display_sections for row in rows]
        self.selected = min(self.selected, max(0, len(self.rows) - 1))

    def request_filter(self, reason):
        if getattr(self, "worker", None) is None:
            self.apply_view()
            return
        self._filter_reason = reason
        self._filter_gen = self.worker.request(self.sections, self.filter, self.query)

    def filter_pending(self):
        return getattr(self, "worker", None) is not None and self._filter_gen != self._applied_gen

    def poll_filter(self):
        if getattr(self, "worker", None) is None:
            return
        finished = self.worker.poll()
        if not finished or finished[0] != self._filter_gen or finished[0] == self._applied_gen:
            return
        self._applied_gen, self.display_sections = finished
        self.rows = [row for _name, rows in self.display_sections for row in rows]
        self.selected = 0
        if self._filter_reason == "filter":
            self.flash = "filter: %s (%d shown)" % (dict(FILTERS)[self.filter], len(self.rows))

    def set_filter(self, name):
        self.filter = name
        self.request_filter("filter")

    def cycle_filter(self, step):
        names = [name for name, _label in FILTERS]
        self.set_filter(names[(names.index(self.filter) + step) % len(names)])

    def row_id(self, row):
        return row.get("pane_id") or row.get("key")

    def preview(self, row):
        if not row or row.get("kind") != "settled":
            return []
        path = row.get("transcript")
        if not path:
            return []  # no messages to show; the status bar says why
        try:
            stat = os.stat(path)
            cache_key = (path, stat.st_size, stat.st_mtime)
        except OSError:
            return []  # transcript gone: the status bar's note, not a fake message
        if cache_key not in self.preview_cache:
            self.preview_cache[cache_key] = tail_messages(path)
        return self.preview_cache[cache_key] or [("—", "no messages in the transcript tail")]

    # The shortcuts cheatsheet, rendered in a fixed sidebar on the right of
    # the popup (herdr popups cannot cover herdr's own sidebar -- overlay
    # turned out to be a zoomed pane -- so the column lives in the window).
    CHEATSHEET = [
        ("enter", "open / jump"), ("s", "settle"), ("z", "snooze / wake"),
        ("⌫", "forget settled"), ("u", "undo settle"), ("p", "pin"),
        ("space", "mark (bulk)"), ("tab", "next filter"), ("⇧tab", "prev filter"),
        ("⇧A", "filter: all"), ("⇧P", "filter: pinned"), ("⇧S", "filter: settled"),
        ("⇧W", "filter: working"), ("⇧D", "filter: done/idle"), ("⇧Z", "filter: snoozed"),
        ("alt+z", "snooze list"), ("/", "search"), ("?", "toggle help"), ("q", "close"),
    ]
    PREVIEW_LINES = 4  # label + last 3 messages, always: the list never resizes
    SIDEBAR_W = 28
    # Fixed right-hand columns: same start and end on every row, live or
    # settled. Flags like `transcript gone` do NOT go here -- a variable
    # suffix would break the columns; they are reported in the bottom
    # preview block when the row is highlighted instead.
    AGENT_COL, WORKSPACE_COL, AGE_COL = 9, 12, 9

    def status_line(self, term, row):
        """The one-line bottom status bar: highlighted-row details and
        action feedback on the left, ? hint flush right."""
        hint = "? for help" if not self.show_help else "? hide help"
        if self.searching:
            text = "/" + self.query + "▏  search: enter keep · esc clear"
        elif self.flash:
            text = self.flash
        elif row and row.get("kind") == "live":
            text = "%s · %s -- enter jumps to the pane" % (row.get("status") or "live", row["pane_id"])
        elif row and row.get("kind") == "settled":
            notes = []
            if row.get("gone"):
                notes.append("transcript gone: " + (row.get("transcript") or ""))
            elif not row.get("transcript"):
                notes.append("no transcript recorded for this session")
            if row.get("fallback"):
                notes.append("≈ no session id recorded: reopen uses the most recent in " + (row.get("cwd") or "its cwd"))
            text = " · ".join(notes)
        else:
            text = ""
        # End one column short of the edge: a character written into the
        # very last column sits in wrap-pending and gets eaten by the next
        # escape, which is how "? for help" lost its p.
        text = "  " + clip(text, max(10, term.cols - len(hint) - 4))
        return pad_visible(text, max(0, term.cols - len(hint) - 2)) + " " + DIM + hint + RESET

    def sidebar_lines(self, height):
        lines = [BOLD + "Shortcuts" + RESET, DIM + "─" * 20 + RESET]
        for key, action in self.CHEATSHEET:
            lines.append(BOLD + "%-6s" % key + RESET + DIM + action + RESET)
        lines += ["", BOLD + "Filter" + RESET,
                  DIM + "%s · %d shown" % (dict(FILTERS)[self.filter], len(self.rows)) + RESET]
        if self.query:
            lines.append(DIM + "/" + self.query + RESET)
        return (lines + [""] * height)[:height]

    def draw(self, term):
        # Layout, fixed on every frame: header at the top, list (left) +
        # cheatsheet sidebar (right) in the middle, the last-messages
        # preview in a dedicated block spanning the full width (messages
        # and nothing else; constant height, so the list never resizes),
        # and a one-line status bar as the LAST line: the highlighted
        # row's details (transcript gone, reopen fallback, live status),
        # action feedback, and the ? hint at the right. Row columns never
        # carry those flags -- a variable suffix would break the columns.
        sidebar_w = self.SIDEBAR_W if (self.show_help and term.cols >= 60) else 0
        left_w = term.cols - sidebar_w
        width = max(20, left_w - 4)
        height = max(6, term.rows - self.PREVIEW_LINES - 1)  # +1: the status bar
        header = []  # no in-content heading: the popup itself is named Agent Sessions (see name_self)
        row = self.rows[self.selected] if self.rows else None
        preview = []
        if self.confirm:
            preview.append("  " + BOLD + "Settle %s?" % self.confirm["label"] + RESET)
            preview.append("  " + DIM + "the pane closes; the session moves to Settled and can be reopened" + RESET)
            preview.append("  " + BOLD + "s/enter confirm · esc cancel" + RESET)
        elif row and row.get("kind") == "settled":
            preview.append("  " + DIM + "last messages:" + RESET)
            for role, text in self.preview(row)[:3]:
                preview.append("  " + (BOLD + "you  " + RESET if role == "user" else DIM + "agent" + RESET) + " " + clip(text, term.cols - 24))
        preview = (preview + [""] * self.PREVIEW_LINES)[: self.PREVIEW_LINES]
        status = self.status_line(term, row)
        room = max(3, height - len(header))
        full = []
        selected_line = 0
        index = -1
        for name, rows in self.display_sections:
            full.append("  " + BOLD + name.upper() + RESET)
            for item in rows:
                index += 1
                if index == self.selected:
                    selected_line = len(full)
                right = "%-*s %-*s %*s" % (
                    self.AGENT_COL, clip(item.get("agent_name") or "", self.AGENT_COL),
                    self.WORKSPACE_COL, clip(item.get("workspace_label") or "", self.WORKSPACE_COL),
                    self.AGE_COL, clip(item.get("age") or "", self.AGE_COL))
                # Title on the left, the three columns flush right after it.
                # The cursor highlights ONLY the title text; a marked row
                # keeps its background wash whether the cursor is on it or
                # not (previously the selected row inverted wholesale, which
                # swallowed the mark and shouted over every other row).
                label = clip(item["title"], max(10, width - len(right) - 4))
                gap = " " * max(1, width - 3 - len(label) - len(right))
                detail = right
                if self.row_id(item) in self.marked:
                    title = REVERSE + label + RESET + MARK_BG if index == self.selected else label
                    text = MARK_BG + "   " + title + gap + detail + RESET
                elif index == self.selected:
                    text = "   " + REVERSE + label + RESET + gap + detail
                else:
                    text = "   " + label + gap + detail
                full.append(text)
        if not full:
            full = ["  " + DIM + "nothing matches" + RESET]
        start = 0 if len(full) <= room else min(max(0, selected_line - room // 2), len(full) - room)
        body = full[start:start + room]
        left = (header + body + [""] * height)[:height]
        sidebar = self.sidebar_lines(height)
        lines = []
        for i in range(height):
            line = left[i] if i < len(left) else ""
            if sidebar_w:
                lines.append(pad_visible(line, left_w) + DIM + "│ " + RESET + sidebar[i])
            else:
                lines.append(line)
        lines += preview  # above the status bar, exclusively: last messages
        lines.append(status)
        term.draw(lines[: term.rows])

    def confirm_settle(self):
        pane_ids = (self.confirm or {}).get("pane_ids") or []
        self.confirm = None
        done = [settle_pane(pane_id) for pane_id in pane_ids]
        self.flash = "; ".join(done)
        self.reload()

    def cancel_confirm(self):
        self.confirm = None
        self.flash = "settle cancelled"

    def act(self, action, row):
        """Run one action; returns True when the picker should close."""
        if row is None:
            return False
        targets = [r for r in self.rows if self.row_id(r) in self.marked] or [row]
        if action == "enter":
            if row.get("kind") == "live":
                call("agent.focus", {"target": row["pane_id"]})
                self.flash = "jumped to %s" % row["pane_id"]
                return True
            self.flash = reopen(row["key"])
            return True
        if action == "settle":
            live = [r for r in targets if r.get("kind") == "live"]
            if not live:
                self.flash = "only live rows can be settled"
            else:
                # Settling closes a pane: confirm first (bulk included).
                self.confirm = {
                    "pane_ids": [r["pane_id"] for r in live],
                    "label": live[0]["title"] if len(live) == 1 else "%d conversations" % len(live),
                }
            self.marked.clear()
            self.reload()
            return False
        elif action == "snooze":
            out = []
            for r in targets:
                if r.get("kind") != "live":
                    continue
                if r.get("snoozed"):
                    out += _sibling_script("herdr-snooze.py", ["wake", r["pane_id"]])
                else:
                    out += _sibling_script("herdr-snooze.py", ["snooze", r["pane_id"], SNOOZE_DEFAULT])
            self.flash = "; ".join(out[-2:]) if out else "only live rows can be snoozed (new snoozes: %s)" % SNOOZE_DEFAULT
        elif action == "pin":
            if row.get("kind") == "live":
                _sibling_script("agent-handler.py", ["pin", "--pane", row["pane_id"]])
                self.flash = "pin toggled on %s" % row["pane_id"]
        elif action == "forget":
            gone = [forget(r["key"]) for r in targets if r.get("kind") == "settled"]
            self.flash = "; ".join(gone) or "only settled rows can be forgotten"
        elif action == "undo":
            key = last_settled_key()
            self.flash = reopen(key) if key else "nothing settled to undo"
            return bool(key)
        self.marked.clear()
        self.reload()
        return False


def name_self():
    """Name this popup 'Agent Sessions' in herdr's UI (the border/tab title),
    instead of carrying a heading inside the content. The plugin-pane path
    gets the name from the manifest's [[panes]] title; a [[keys.command]]
    popup has no title field, so the picker renames its own pane -- herdr
    injects HERDR_PANE_ID into every managed pane, popups included."""
    pane_id = os.environ.get("HERDR_PANE_ID")
    try:
        if pane_id:
            call("pane.rename", {"pane_id": pane_id, "label": "Agent Sessions"})
        sys.stdout.write("\x1b]2;Agent Sessions\x07")  # terminal title, for popup borders that follow it
        sys.stdout.flush()
    except (OSError, ValueError, HerdrError):
        pass


def open_picker():
    """What prefix+alt+s runs: open the picker through the plugin registry,
    not as a bare [[keys.command]] popup -- a keys.command popup is titled
    'popup' and cannot be renamed, while a plugin pane carries the
    manifest's title ('Agent Sessions') as its label."""
    try:
        call("plugin.pane.open", {
            "plugin_id": PLUGIN_ID, "entrypoint": "picker", "placement": "popup",
            "focus": True, "width": "80%", "height": "75%",
        })
    except HerdrError as problem:
        if problem.code == "ui_busy":
            notify("Agent Sessions", "a popup is already open: close it (q) and try again")
        else:
            notify("Agent Sessions", "couldn't open: %s" % problem)
        return 1
    return 0


def run_picker():
    name_self()
    picker = Picker()
    with RawTerminal() as term:
        try:
            return _picker_loop(picker, term)
        finally:
            picker.close()


def _picker_loop(picker, term):
    if True:
        while True:
            picker.draw(term)
            name, raw = term.key(timeout=0.03 if picker.filter_pending() else None)
            if name is None:
                picker.poll_filter()
                continue
            if picker.confirm:
                if name in ("esc", "eof"):
                    picker.cancel_confirm()
                elif name == "enter" or raw.decode("utf-8", "ignore").lower() in ("s", "y"):
                    picker.confirm_settle()
                continue
            if picker.searching:
                if name in ("esc", "eof"):
                    picker.query = ""
                    picker.searching = False
                    picker.request_filter("search")
                elif name == "enter":
                    picker.searching = False
                elif name == "backspace":
                    picker.query = picker.query[:-1]
                    picker.request_filter("search")
                elif name == "space":
                    picker.query += " "  # b" " decodes as the named key `space`, not `char`
                    picker.request_filter("search")
                elif name == "char":
                    typed = raw.decode("utf-8", "ignore")
                    if typed.isprintable() and typed:
                        picker.query += typed
                        picker.request_filter("search")
                continue
            if name in ("esc", "eof"):
                break
            if name == "tab":
                picker.cycle_filter(1)
            elif name == "shift-tab":
                picker.cycle_filter(-1)
            elif raw == b"\x1bz":
                # Alt+Z: the snooze list (the same popup prefix+alt+z opens).
                picker.handoff_snooze = True
                break
            elif raw.decode("utf-8", "ignore") in FILTER_KEYS:
                # Without the continue, the lower-cased dispatch below would
                # also read Shift+S as `s` (settle), Shift+P as `p` (pin).
                picker.set_filter(FILTER_KEYS[raw.decode("utf-8", "ignore")])
                continue
            if name in ("up", "down"):
                step = -1 if name == "up" else 1
                count = 1
                while True:
                    nxt = term.peek_key()
                    if not nxt or nxt[0] != name:
                        break
                    term.key()
                    count += 1
                picker.selected = min(max(0, len(picker.rows) - 1), max(0, picker.selected + step * count))
            elif name == "pgup":
                picker.selected = max(0, picker.selected - 8)
            elif name == "pgdn":
                picker.selected = min(max(0, len(picker.rows) - 1), picker.selected + 8)
            elif name == "home":
                picker.selected = 0
            elif name == "end":
                picker.selected = max(0, len(picker.rows) - 1)
            elif name == "backspace":
                row = picker.rows[picker.selected] if picker.rows else None
                if row:
                    picker.act("forget", row)
            elif name == "space":
                row = picker.rows[picker.selected] if picker.rows else None
                if row:
                    rid = picker.row_id(row)
                    picker.marked.symmetric_difference_update({rid})
            elif name == "enter":
                row = picker.rows[picker.selected] if picker.rows else None
                if picker.act("enter", row):
                    break
            elif raw == b"?":
                picker.show_help = not picker.show_help
            elif raw == b"/":
                picker.searching = True
            else:
                typed = raw.decode("utf-8", "ignore").lower()
                row = picker.rows[picker.selected] if picker.rows else None
                action = {"s": "settle", "z": "snooze", "p": "pin", "u": "undo"}.get(typed)
                if action and picker.act(action, row):
                    break
    if picker.handoff_snooze:
        # The snooze picker is a plugin popup; ours has to be gone before
        # herdr will open it (one popup at a time), so a detached helper
        # asks a moment later.
        subprocess.Popen(
            [sys.executable, os.path.abspath(__file__), "handoff-snooze"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=True, close_fds=True,
        )
    return 0


def handoff_snooze():
    time.sleep(0.35)
    try:
        call("plugin.pane.open", {
            "plugin_id": "herdr-snooze", "entrypoint": "picker", "placement": "popup",
            "focus": True, "width": "72%", "height": "70%",
            "env": {"HERDR_SNOOZE_SCREEN": "list", "SNOOZE_SCREEN": "list"},
        })
    except (OSError, ValueError, HerdrError) as problem:
        notify("Settled", "couldn't open the snooze list: %s" % problem)
    return 0


# ── CLI ──────────────────────────────────────────────────────────────────────

USAGE = """usage: herdr-settled.py <command>
  tick                          capture closed sessions into the registry (hooks run this)
  picker                        the popup: every section, live + settled
  open                          open the picker as a named plugin popup (prefix+alt+s runs this)
  list                          settled sessions, one per line
  reopen <conversation>         reopen a settled session in a new tab
  settle <pane_id>              settle a live agent: freeze it, then close its pane
  forget <conversation>         drop a settled entry (never touches the transcript)
  resume-cmd <conversation>     print the command reopen would run
  handoff-snooze                (internal) open the snooze picker after this popup closes"""


def main(argv):
    if not argv:
        print(USAGE)
        return 2
    command, args = argv[0], argv[1:]
    if command == "tick":
        return tick()
    if command == "picker":
        return run_picker()
    if command == "open":
        return open_picker()
    if command == "handoff-snooze":
        return handoff_snooze()
    if command == "list":
        settled = read_registry().get("settled") or {}
        for key, entry in sorted(settled.items(), key=lambda kv: kv[1].get("settled_at") or 0, reverse=True):
            print("%s\t%s\t%s\t%s" % (key, entry.get("agent") or "", entry.get("cwd") or "", entry.get("title") or ""))
        if not settled:
            print("nothing settled")
        return 0
    if command == "reopen" and len(args) == 1:
        print(reopen(args[0]))
        return 0
    if command == "settle" and len(args) == 1:
        print(settle_pane(args[0]))
        return 0
    if command == "forget" and len(args) == 1:
        print(forget(args[0]))
        return 0
    if command == "resume-cmd" and len(args) == 1:
        entry = (read_registry().get("settled") or {}).get(args[0])
        if entry is None:
            print("not settled: %s" % args[0], file=sys.stderr)
            return 1
        command_line = resume_command(entry)
        if command_line is None:
            print("no resume command known for agent %r" % (entry.get("agent") or ""), file=sys.stderr)
            return 1
        print(command_line)
        return 0
    print(USAGE)
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except (OSError, HerdrError) as problem:
        print("settled:", problem, file=sys.stderr)
        sys.exit(1)
