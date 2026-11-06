#!/usr/bin/env python3
"""Agent handler for Herdr agent panes.

This script owns the local agent sidebar state that Herdr does not provide:

* animated status glyphs in the same sidebar slot as Herdr's normal status;
* a manual unread marker (local reimplementation of the useful bits of
  https://github.com/JoanGil/herdr-unread-marker), cleared when its pane gains
  focus;
* chat pins (prefix+p): a Nerd Font pin glyph beside the status glyph, plus
  agent.view.set ordering so pinned chats float to the top.

State is private machine state under $XDG_STATE_HOME/herdr/agent-handler*.
State written by the former unread-marker.py name migrates on first use.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import random
import select
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

SOURCE = "agent-handler"
LEGACY_SOURCE = "unread-marker"
MARK_TOKEN = "um_marked"
PIN_TOKEN = "um_pin"
LEGACY_TOKEN = "unread"

# Exactly one of these visible tokens is set on a pane at a time. config.toml
# renders them before the title, styled individually, in place of state_icon.
VISIBLE_TOKENS = {
    "unread": "um_unread",
    "blocked": "um_blocked",
    "working": "um_working",
    "done": "um_done",
    "idle": "um_idle",
    "unknown": "um_unknown",
}
STATUS_GLYPHS = {
    "blocked": (VISIBLE_TOKENS["blocked"], "×"),
    "done": (VISIBLE_TOKENS["done"], "✓"),
    "idle": (VISIBLE_TOKENS["idle"], "○"),
    "unknown": (VISIBLE_TOKENS["unknown"], "·"),
}
# Rotating half-circle spinner for working agents (matches symbols mode's ◐).
WORKING_FRAMES = ["◐", "◓", "◑", "◒"]
# Pi's titlebar-spinner example uses an 80ms frame interval.
ANIMATION_SECS = 0.08
# Refresh agent.list at most once per second during continuous spinner animation
# unless woken immediately by an event hook (SIGUSR1) or state file change.
AGENT_LIST_REFRESH_SECS = 1.0
# Nerd Fonts Material Design email (nf-md-email), used as the manual unread
# marker in the status slot. It reads larger than Font Awesome's envelope.
# Falls back to tofu only if the outer terminal font is not a Nerd Font.
UNREAD_GLYPH = "󰇮"
# Nerd Fonts Material Design pin (nf-md-pin), rendered alongside the current
# status glyph when an agent chat is pinned.
PIN_GLYPH = "󰐃"
# Sidebar panel order, top to bottom: pinned, blocked, done, idle, unknown,
# working; most recent state change first within a status. Herdr's native
# "priority" sort puts working above idle, so the sort runs on a reported
# token instead of the opaque "attention" rank: um_sort is the status rank
# digit followed by the inverted state_change_seq (zero-padded, so plain
# lexicographic order is rank ascending, then newest first).
#
# The focused agent's um_sort is FROZEN: while an agent has focus, its token
# stops tracking status/seq, so submitting a prompt (idle -> working) does
# not move it out of its pile mid-thought. Other agents keep sorting live
# around it. When focus moves to another agent or pane, the token unfreezes
# and the agent lands wherever its current status puts it.
RANK_TOKEN = "um_rank"
SORT_TOKEN = "um_sort"
# Set to "1" on the focused agent only. The agent-view filter language has
# no "focused" field, so this token is how working-hidden mode exempts the
# focused agent (see NOT_WORKING_FILTER below).
ACTIVE_TOKEN = "um_active"
# Virtual display label for workspaces whose automatic cwd-derived label is
# "~" ($HOME). config.toml hides the built-in "workspace" token when it equals
# "~" and renders $um_home / $um_home_active in its place, keeping the
# underlying workspace custom_name unset so the label stays virtual.
HOME_TOKEN = "um_home"
HOME_ACTIVE_TOKEN = "um_home_active"
HOME_DISPLAY = "home"
STATUS_RANK = {
    "blocked": "0",
    "done": "1",
    "idle": "2",
    "unknown": "3",
    "working": "4",
}
VIEW_SORT = [
    {"field": {"token": PIN_TOKEN}, "order": "asc"},
    {"field": {"token": SORT_TOKEN}, "order": "asc"},
    {"field": "state_change_seq", "order": "desc"},
]


def sort_token(status: str, seq: int) -> str:
    rank = STATUS_RANK.get(status, STATUS_RANK["unknown"])
    return f"{rank}:{999_999_999_999 - seq:012d}"


def usable_sort(value: Any) -> str | None:
    """A captured sort token, or None if it is missing/malformed. A token
    encoding seq 0 is the token_patch default for "seq unknown", not a real
    position, so it never counts as a frozen position worth keeping."""
    if not isinstance(value, str) or len(value) != 14 or value[1] != ":":
        return None
    if value[:1] not in STATUS_RANK.values() or not value[2:].isdigit():
        return None
    if 999_999_999_999 - int(value[2:]) <= 0:
        return None
    return value

# prefix+w cycles the Agents panel through these modes (config.toml binds
# it to `cycle-panel`): grouped (workspace order) -> smart priority (the
# um_sort order above) -> working hidden (smart priority, working filtered
# out) -> grouped... The mode is a file in the state dir so the daemon, the
# cycle-panel op, and restarts agree. The view's label is the panel button's
# text, so labels are plain words: in particular "working hidden" carries no
# snooze badge -- the 💤 is snooze's, and a hidden working agent is not snoozed.
PANEL_MODES = ("grouped", "smart", "hidden")
PANEL_LABELS = {
    "grouped": "grouped",
    "smart": "smart priority",
    "hidden": "working hidden",
}
GROUPED_SORT = [
    {"field": "workspace_order", "order": "asc"},
    {"field": "tab_order", "order": "asc"},
    {"field": "pane_order", "order": "asc"},
]
# Working-hidden mode: same um_sort order as smart priority, but working
# agents are filtered out -- except the focused one, which stays visible
# (in its frozen position) until focus moves to another agent or pane.
NOT_WORKING_FILTER = {
    "op": "any",
    "filters": [
        {"op": "not", "filter": {"op": "eq", "field": "status", "value": "working"}},
        {"op": "exists", "field": {"token": ACTIVE_TOKEN}},
    ],
}


def panel_mode_path() -> Path:
    return state_dir() / "panel-mode"


def load_panel_mode() -> str:
    try:
        mode = panel_mode_path().read_text(encoding="utf-8").strip()
    except OSError:
        return "smart"
    return mode if mode in PANEL_MODES else "smart"


def save_panel_mode(mode: str) -> None:
    panel_mode_path().write_text(mode + "\n", encoding="utf-8")


def view_params() -> dict[str, Any]:
    mode = load_panel_mode()
    params: dict[str, Any] = {
        "source": SOURCE,
        "label": PANEL_LABELS[mode],
        "sort": GROUPED_SORT if mode == "grouped" else VIEW_SORT,
        "filter": NOT_WORKING_FILTER if mode == "hidden" else None,
    }
    return params


def socket_path() -> str:
    return os.environ.get("HERDR_SOCKET_PATH") or os.path.expanduser(
        "~/.config/herdr/herdr.sock"
    )


def session_name() -> str:
    parent = Path(socket_path()).parent
    if parent.parent.name == "sessions":
        return parent.name
    return ""


def state_dir() -> Path:
    base = Path(os.environ.get("XDG_STATE_HOME") or os.path.expanduser("~/.local/state"))
    suffix = f"@{session_name()}" if session_name() else ""
    path = base / "herdr" / f"agent-handler{suffix}"
    if not path.is_dir():
        legacy = base / "herdr" / f"unread-marker{suffix}"
        try:
            if legacy.is_dir():
                shutil.copytree(legacy, path)
            else:
                path.mkdir(mode=0o700, parents=True, exist_ok=True)
            path.chmod(0o700)
        except OSError:
            try:
                path.mkdir(mode=0o700, parents=True, exist_ok=True)
            except OSError:
                pass
    return path


def marked_path() -> Path:
    return state_dir() / "marked.json"


def pinned_path() -> Path:
    return state_dir() / "pinned.json"


def file_mtime_ns(path: Path) -> int | None:
    try:
        return path.stat().st_mtime_ns
    except OSError:
        return None


def load_key_set(path: Path) -> set[str]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return set()
    if isinstance(data, list):
        return {str(item) for item in data if item}
    return set()


def save_key_set(path: Path, keys: set[str]) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(sorted(keys), indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def load_marked() -> set[str]:
    return load_key_set(marked_path())


def save_marked(marked: set[str]) -> None:
    save_key_set(marked_path(), marked)


def load_pinned() -> set[str]:
    return load_key_set(pinned_path())


def save_pinned(pinned: set[str]) -> None:
    save_key_set(pinned_path(), pinned)


def frozen_path() -> Path:
    return state_dir() / "frozen.json"


def load_frozen() -> dict[str, str]:
    try:
        data = json.loads(frozen_path().read_text(encoding="utf-8"))
    except Exception:
        return {}
    if isinstance(data, dict):
        return {str(k): str(v) for k, v in data.items() if k and v}
    return {}


def save_frozen(frozen: dict[str, str]) -> None:
    tmp = frozen_path().with_suffix(".tmp")
    tmp.write_text(json.dumps(frozen, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(tmp, frozen_path())


def request(method: str, params: dict[str, Any], timeout: float = 2.0) -> dict[str, Any]:
    payload = {
        "id": f"{SOURCE}:{int(time.time() * 1000)}:{random.randrange(1_000_000):06d}",
        "method": method,
        "params": params,
    }
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    client.settimeout(timeout)
    try:
        client.connect(socket_path())
        client.sendall((json.dumps(payload) + "\n").encode())
        chunks: list[bytes] = []
        while True:
            chunk = client.recv(65536)
            if not chunk:
                break
            chunks.append(chunk)
            if b"\n" in chunk:
                break
    finally:
        client.close()
    if not chunks:
        return {}
    line = b"".join(chunks).split(b"\n", 1)[0]
    try:
        return json.loads(line.decode())
    except Exception:
        return {}


def pane_id_from_context() -> str | None:
    for name in ("HERDR_ACTIVE_PANE_ID", "HERDR_PANE_ID"):
        value = os.environ.get(name)
        if value:
            return value
    for name in ("HERDR_PLUGIN_EVENT_JSON", "HERDR_PLUGIN_CONTEXT_JSON"):
        raw = os.environ.get(name)
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except Exception:
            continue
        for candidate in (
            data.get("focused_pane_id"),
            data.get("pane_id"),
            (data.get("data") or {}).get("pane_id") if isinstance(data.get("data"), dict) else None,
        ):
            if isinstance(candidate, str) and candidate:
                return candidate
    return None


def pane_get(pane_id: str) -> dict[str, Any] | None:
    response = request("pane.get", {"pane_id": pane_id})
    pane = (response.get("result") or {}).get("pane")
    return pane if isinstance(pane, dict) else None


def pane_key(pane: dict[str, Any], pane_id: str) -> str:
    terminal_id = pane.get("terminal_id")
    return terminal_id if isinstance(terminal_id, str) and terminal_id else f"pane:{pane_id}"


def pane_marked(pane: dict[str, Any], pane_id: str, marked: set[str]) -> bool:
    tokens = pane.get("tokens") or {}
    return tokens.get(MARK_TOKEN) == "1" or pane_key(pane, pane_id) in marked


def pane_pinned(pane: dict[str, Any], pane_id: str, pinned: set[str]) -> bool:
    tokens = pane.get("tokens") or {}
    return bool(tokens.get(PIN_TOKEN)) or pane_key(pane, pane_id) in pinned


def status_name(pane: dict[str, Any]) -> str:
    status = pane.get("agent_status")
    if isinstance(status, str) and status in VISIBLE_TOKENS:
        return status
    return "unknown"


def token_patch(
    status: str,
    marked: bool,
    pinned: bool = False,
    frame: int = 0,
    sort_value: str | None = None,
    active: bool = False,
    in_home: bool = False,
) -> dict[str, str | None]:
    tokens: dict[str, str | None] = {name: None for name in VISIBLE_TOKENS.values()}
    # Clear the first version of this script too.
    tokens[LEGACY_TOKEN] = None
    tokens[MARK_TOKEN] = "1" if marked else None
    tokens[PIN_TOKEN] = PIN_GLYPH if pinned else None
    if sort_value is None:
        sort_value = sort_token(status, 0)
    tokens[SORT_TOKEN] = sort_value
    tokens[ACTIVE_TOKEN] = "1" if active else None
    tokens[HOME_TOKEN] = HOME_DISPLAY if in_home else None
    # The rank digit of the (possibly frozen) sort token; kept for readers
    # that only need the effective category.
    tokens[RANK_TOKEN] = sort_value[:1]
    if marked:
        tokens[VISIBLE_TOKENS["unread"]] = UNREAD_GLYPH
    elif status == "working":
        tokens[VISIBLE_TOKENS["working"]] = WORKING_FRAMES[frame % len(WORKING_FRAMES)]
    else:
        token, glyph = STATUS_GLYPHS.get(status, STATUS_GLYPHS["unknown"])
        tokens[token] = glyph
    return tokens


def report_tokens(pane_id: str, tokens: dict[str, str | None]) -> None:
    request(
        "pane.report_metadata",
        {
            "pane_id": pane_id,
            "source": SOURCE,
            "tokens": tokens,
        },
    )


def report(
    pane_id: str,
    pane: dict[str, Any],
    marked: bool,
    pinned: bool = False,
    frame: int = 0,
) -> None:
    # Keep whatever sort token the pane already carries: a mark/pin toggle
    # must not re-sort the agent (notably not unfreeze the focused one).
    # Without one, fall back to the pane's own seq, not seq 0.
    existing = usable_sort((pane.get("tokens") or {}).get(SORT_TOKEN))
    if existing is None:
        seq = pane.get("state_change_seq")
        existing = sort_token(status_name(pane), seq if isinstance(seq, int) else 0)
    report_tokens(
        pane_id,
        token_patch(
            status_name(pane),
            marked,
            pinned,
            frame,
            existing,
            (pane.get("tokens") or {}).get(ACTIVE_TOKEN) == "1",
            (pane.get("tokens") or {}).get(HOME_TOKEN) == HOME_DISPLAY,
        ),
    )


def sync_view(want_active: bool) -> bool:
    if not want_active:
        ok = False
        for src in (SOURCE, LEGACY_SOURCE):
            response = request("agent.view.clear", {"source": src})
            ok = isinstance(response.get("result"), dict) or ok
        return ok
    probe = request("agent.view.clear", {"source": f"{SOURCE}.probe"})
    result = probe.get("result")
    if not isinstance(result, dict):
        return False
    owner = result.get("source") if result.get("active") else None
    if isinstance(owner, str) and owner and owner not in (SOURCE, LEGACY_SOURCE):
        # Another owner (for example herdr-snooze) holds the single agent
        # view. It mirrors our sort for our label (see its KNOWN_VIEWS).
        return True
    response = request("agent.view.set", view_params())
    return isinstance(response.get("result"), dict)


def resolve_target_pane(
    pane_id: str,
    op: str,
) -> tuple[str, dict[str, Any]] | tuple[None, None]:
    pane = pane_get(pane_id)
    if not pane:
        return None, None
    if op == "focus" or pane.get("agent") or pane.get("agent_status"):
        return pane_id, pane
    tab_id = pane.get("tab_id")
    if isinstance(tab_id, str) and tab_id:
        for agent in fetch_agents() or ():
            agent_pane_id = agent.get("pane_id")
            if (
                agent.get("tab_id") == tab_id
                and isinstance(agent_pane_id, str)
                and agent_pane_id
            ):
                target = pane_get(agent_pane_id) or agent
                return agent_pane_id, target
    return pane_id, pane


def apply_one(
    pane_id: str,
    op: str,
    marked: set[str],
    pinned: set[str],
) -> tuple[bool, bool]:
    if op in {"unmark", "focus"} and not marked:
        return False, False
    if op == "unpin" and not pinned:
        return False, False
    target_pane_id, pane = resolve_target_pane(pane_id, op)
    if not target_pane_id or not pane:
        return False, False
    key = pane_key(pane, target_pane_id)
    is_marked = pane_marked(pane, target_pane_id, marked)
    is_pinned = pane_pinned(pane, target_pane_id, pinned)
    want_marked = is_marked
    want_pinned = is_pinned

    if op == "toggle":
        want_marked = not is_marked
    elif op == "mark":
        want_marked = True
    elif op in {"unmark", "focus"}:
        want_marked = False
    elif op == "pin":
        want_pinned = not is_pinned
    elif op == "unpin":
        want_pinned = False

    if (
        want_marked == is_marked
        and want_pinned == is_pinned
        and op in {"mark", "unmark", "focus", "unpin"}
    ):
        return False, False

    if want_marked:
        marked.add(key)
    else:
        marked.discard(key)
    if want_pinned:
        pinned.add(key)
    else:
        pinned.discard(key)

    report(
        target_pane_id,
        pane,
        want_marked,
        want_pinned,
        int(time.monotonic() / ANIMATION_SECS),
    )
    return want_marked != is_marked or op == "toggle", want_pinned != is_pinned or op == "pin"


def fetch_agents() -> list[dict[str, Any]] | None:
    response = request("agent.list", {})
    agents = (response.get("result") or {}).get("agents")
    if not isinstance(agents, list):
        return None
    return [agent for agent in agents if isinstance(agent, dict)]


def fetch_workspaces() -> list[dict[str, Any]] | None:
    response = request("workspace.list", {})
    workspaces = (response.get("result") or {}).get("workspaces")
    if not isinstance(workspaces, list):
        return None
    return [ws for ws in workspaces if isinstance(ws, dict)]


def sync_workspaces(workspaces: list[dict[str, Any]] | None) -> set[str]:
    home_workspaces: set[str] = set()
    if not workspaces:
        return home_workspaces
    for ws in workspaces:
        wid = ws.get("workspace_id")
        if not isinstance(wid, str) or not wid:
            continue
        is_home = ws.get("label") == "~"
        if is_home:
            home_workspaces.add(wid)
        focused = bool(ws.get("focused"))
        want = {
            HOME_TOKEN: HOME_DISPLAY if (is_home and not focused) else None,
            HOME_ACTIVE_TOKEN: HOME_DISPLAY if (is_home and focused) else None,
        }
        live = ws.get("tokens") or {}
        if live.get(HOME_TOKEN) != want[HOME_TOKEN] or live.get(HOME_ACTIVE_TOKEN) != want[HOME_ACTIVE_TOKEN]:
            request(
                "workspace.report_metadata",
                {
                    "workspace_id": wid,
                    "source": SOURCE,
                    "tokens": want,
                },
            )
    return home_workspaces


def fetch_pane_keys() -> set[str] | None:
    response = request("pane.list", {})
    panes = (response.get("result") or {}).get("panes")
    if not isinstance(panes, list):
        return None
    keys: set[str] = set()
    for pane in panes:
        if not isinstance(pane, dict):
            continue
        pane_id = pane.get("pane_id")
        if isinstance(pane_id, str) and pane_id:
            keys.add(pane_key(pane, pane_id))
    return keys


def sync_agents(
    agents: list[dict[str, Any]],
    marked: set[str],
    pinned: set[str],
    frame: int = 0,
    cache: dict[str, dict[str, str | None]] | None = None,
    frozen: dict[str, str] | None = None,
    home_workspaces: set[str] | None = None,
) -> tuple[set[str], set[str], dict[str, str], bool, bool]:
    if frozen is None:
        frozen = {}
    if home_workspaces is None:
        home_workspaces = set()
    live_keys: set[str] = set()
    live_panes: set[str] = set()
    has_working = False
    server_unsynced = False
    for agent in agents:
        pane_id = agent.get("pane_id")
        if not isinstance(pane_id, str) or not pane_id:
            continue
        key = pane_key(agent, pane_id)
        live_keys.add(key)
        live_panes.add(pane_id)
        status = status_name(agent)
        is_marked = key in marked or (agent.get("tokens") or {}).get(MARK_TOKEN) == "1"
        is_pinned = key in pinned
        if status == "working" and not is_marked:
            has_working = True
        seq = agent.get("state_change_seq")
        live_sort = sort_token(status, seq if isinstance(seq, int) else 0)
        if agent.get("focused"):
            # Freeze: keep the sort token the agent already had (from the
            # frozen file, or the one the server still carries) so status
            # changes under focus do not move it. First sight while focused
            # captures the live token.
            previous = usable_sort((agent.get("tokens") or {}).get(SORT_TOKEN))
            effective_sort = usable_sort(frozen.get(key)) or previous or live_sort
            frozen[key] = effective_sort
        else:
            effective_sort = live_sort
            frozen.pop(key, None)
        in_home = agent.get("workspace_id") in home_workspaces
        tokens = token_patch(
            status,
            is_marked,
            is_pinned,
            frame,
            effective_sort,
            bool(agent.get("focused")),
            in_home,
        )
        live_tokens = agent.get("tokens") or {}
        if not any(live_tokens.get(name) for name in VISIBLE_TOKENS.values()):
            server_unsynced = True
        if (
            cache is None
            or cache.get(pane_id) != tokens
            or live_tokens.get(PIN_TOKEN) != tokens[PIN_TOKEN]
            or live_tokens.get(MARK_TOKEN) != tokens[MARK_TOKEN]
            or live_tokens.get(SORT_TOKEN) != tokens[SORT_TOKEN]
            or live_tokens.get(HOME_TOKEN) != tokens[HOME_TOKEN]
            or server_unsynced
        ):
            report_tokens(pane_id, tokens)
            agent["tokens"] = dict(tokens)
            if cache is not None:
                cache[pane_id] = tokens
    if cache is not None:
        for pane_id in set(cache) - live_panes:
            cache.pop(pane_id, None)
    # Keep state for panes that still exist in pane.list (e.g. during startup
    # before agent detection finishes, or when an agent exited to a shell).
    missing_keys = (marked | pinned | set(frozen)) - live_keys
    if missing_keys:
        pane_keys = fetch_pane_keys()
        if pane_keys is None:
            keep_keys = live_keys | missing_keys
        else:
            keep_keys = live_keys | pane_keys
    else:
        keep_keys = live_keys
    return (
        {key for key in marked if key in keep_keys},
        {key for key in pinned if key in keep_keys},
        {key: value for key, value in frozen.items() if key in keep_keys},
        has_working,
        server_unsynced,
    )


def sync_all(
    marked: set[str],
    pinned: set[str],
    frame: int = 0,
    cache: dict[str, dict[str, str | None]] | None = None,
) -> tuple[set[str], set[str]]:
    home_workspaces = sync_workspaces(fetch_workspaces())
    agents = fetch_agents()
    if agents is None:
        return marked, pinned
    frozen = load_frozen()
    frozen_before = dict(frozen)
    pruned_marked, pruned_pinned, pruned_frozen, _, _ = sync_agents(
        agents, marked, pinned, frame, cache, frozen, home_workspaces
    )
    if pruned_frozen != frozen_before:
        save_frozen(pruned_frozen)
    # Always own the view: VIEW_SORT is the panel order even with no pins.
    sync_view(True)
    return pruned_marked, pruned_pinned


def daemon_pid() -> int | None:
    try:
        pid = int((state_dir() / "daemon.lock").read_text(encoding="utf-8").strip())
    except Exception:
        return None
    if pid <= 0:
        return None
    try:
        os.kill(pid, 0)
    except OSError:
        return None
    return pid


def notify_daemon() -> bool:
    pid = daemon_pid()
    if not pid or pid == os.getpid():
        return False
    try:
        os.kill(pid, signal.SIGUSR1)
        return True
    except OSError:
        return False


def start_daemon_detached() -> None:
    subprocess.Popen(
        [sys.executable, os.path.realpath(__file__), "daemon"],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def restart_daemon() -> int:
    pid = daemon_pid()
    if pid and pid != os.getpid():
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass
        deadline = time.monotonic() + 2.0
        while time.monotonic() < deadline:
            try:
                os.kill(pid, 0)
            except OSError:
                break
            time.sleep(0.05)
        else:
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass
    try:
        (state_dir() / "daemon.lock").unlink()
    except OSError:
        pass
    start_daemon_detached()
    return 0


def drain_fd(fd: int) -> None:
    while True:
        try:
            if not os.read(fd, 1024):
                break
        except BlockingIOError:
            break
        except OSError:
            break


def daemon_loop() -> int:
    sdir = state_dir()
    lock_path = sdir / "daemon.lock"
    lock = lock_path.open("a+")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return 0

    wakeup_r, wakeup_w = os.pipe()
    os.set_blocking(wakeup_r, False)
    os.set_blocking(wakeup_w, False)
    signal.signal(signal.SIGUSR1, lambda _signum, _frame: None)
    signal.set_wakeup_fd(wakeup_w, warn_on_full_buffer=False)

    lock.seek(0)
    lock.truncate()
    lock.write(str(os.getpid()))
    lock.flush()

    script_path = Path(os.path.realpath(__file__))
    script_mtime = file_mtime_ns(script_path) or 0

    kq = select.kqueue() if hasattr(select, "kqueue") else None
    open_flag = getattr(os, "O_EVTONLY", os.O_RDONLY)
    watched_fds: list[int] = []
    if kq is not None:
        kevents = [
            select.kevent(
                wakeup_r,
                filter=select.KQ_FILTER_READ,
                flags=select.KQ_EV_ADD | select.KQ_EV_ENABLE,
            )
        ]
        vnode_fflags = (
            select.KQ_NOTE_WRITE
            | select.KQ_NOTE_DELETE
            | select.KQ_NOTE_RENAME
            | select.KQ_NOTE_ATTRIB
        )
        for watch_path in (script_path,):
            try:
                fd = os.open(str(watch_path), open_flag)
                watched_fds.append(fd)
                kevents.append(
                    select.kevent(
                        fd,
                        filter=select.KQ_FILTER_VNODE,
                        flags=select.KQ_EV_ADD | select.KQ_EV_ENABLE | select.KQ_EV_CLEAR,
                        fflags=vnode_fflags,
                    )
                )
            except OSError:
                pass
        kq.control(kevents, 0, 0)

    cache: dict[str, dict[str, str | None]] = {}
    marked: set[str] = set()
    marked_mtime: int | None = -1
    pinned: set[str] = set()
    pinned_mtime: int | None = -1
    frozen: dict[str, str] = {}
    frozen_mtime: int | None = -1
    panel_mode_mtime: int | None = -1
    view_active: bool | None = None
    agents: list[dict[str, Any]] | None = None
    home_workspaces: set[str] = set()
    last_fetch_at = 0.0
    force_refresh = True
    frame = 0

    while True:
        has_working = False
        try:
            cur_script_mtime = file_mtime_ns(script_path) or 0
            if script_mtime and cur_script_mtime != script_mtime:
                for fd in watched_fds:
                    os.close(fd)
                os.close(wakeup_r)
                os.close(wakeup_w)
                if kq is not None:
                    kq.close()
                os.execv(sys.executable, [sys.executable, str(script_path), "daemon"])

            cur_marked_mtime = file_mtime_ns(marked_path())
            if cur_marked_mtime != marked_mtime:
                marked = load_marked()
                marked_mtime = cur_marked_mtime
                force_refresh = True

            cur_pinned_mtime = file_mtime_ns(pinned_path())
            if cur_pinned_mtime != pinned_mtime:
                pinned = load_pinned()
                pinned_mtime = cur_pinned_mtime
                force_refresh = True

            cur_panel_mode_mtime = file_mtime_ns(panel_mode_path())
            if cur_panel_mode_mtime != panel_mode_mtime:
                panel_mode_mtime = cur_panel_mode_mtime
                force_refresh = True

            cur_frozen_mtime = file_mtime_ns(frozen_path())
            if cur_frozen_mtime != frozen_mtime:
                frozen = load_frozen()
                frozen_mtime = cur_frozen_mtime
                force_refresh = True

            now = time.monotonic()
            refreshing = (
                force_refresh
                or agents is None
                or (now - last_fetch_at) >= AGENT_LIST_REFRESH_SECS
            )
            check_view = force_refresh
            if refreshing:
                home_workspaces = sync_workspaces(fetch_workspaces())
                fetched = fetch_agents()
                if fetched is not None:
                    agents = fetched
                    last_fetch_at = now
                    force_refresh = False
                else:
                    agents = None
                    cache.clear()
                    view_active = None

            if agents is not None:
                frozen_before = dict(frozen)
                pruned_marked, pruned_pinned, pruned_frozen, has_working, server_unsynced = sync_agents(
                    agents, marked, pinned, frame, cache, frozen, home_workspaces
                )
                if pruned_marked != marked:
                    marked = pruned_marked
                    save_marked(marked)
                    marked_mtime = file_mtime_ns(marked_path())
                if pruned_pinned != pinned:
                    pinned = pruned_pinned
                    save_pinned(pinned)
                    pinned_mtime = file_mtime_ns(pinned_path())
                if pruned_frozen != frozen_before:
                    frozen = pruned_frozen
                    save_frozen(frozen)
                    frozen_mtime = file_mtime_ns(frozen_path())
                want_view = True  # VIEW_SORT is the panel order, pins or not
                if (
                    view_active != want_view
                    or (want_view and (server_unsynced or check_view))
                ):
                    if sync_view(want_view):
                        view_active = want_view

            frame = (frame + 1) % len(WORKING_FRAMES)
        except Exception:
            cache.clear()
            agents = None
            view_active = None

        timeout = ANIMATION_SECS if has_working else (1.0 if agents is None else None)
        if kq is not None:
            events = kq.control(None, 4, timeout)
            for ev in events:
                if ev.ident == wakeup_r:
                    drain_fd(wakeup_r)
                    force_refresh = True
        else:
            rlist, _, _ = select.select([wakeup_r], [], [], ANIMATION_SECS if has_working else 1.0)
            if rlist:
                drain_fd(wakeup_r)
                force_refresh = True


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description="toggle/sync Herdr agent status, unread, and chat pin metadata"
    )
    parser.add_argument(
        "op",
        nargs="?",
        default="toggle",
        choices=[
            "toggle",
            "mark",
            "unmark",
            "pin",
            "unpin",
            "focus",
            "sync",
            "daemon",
            "restart",
            "cycle-panel",
        ],
    )
    parser.add_argument("--pane", dest="pane_id")
    args = parser.parse_args(argv[1:])

    if args.op == "daemon":
        return daemon_loop()
    if args.op == "restart":
        return restart_daemon()

    if args.op == "sync":
        if notify_daemon():
            return 0
        marked = load_marked()
        pinned = load_pinned()
        pruned_marked, pruned_pinned = sync_all(
            marked,
            pinned,
            int(time.monotonic() / ANIMATION_SECS),
        )
        if pruned_marked != marked:
            save_marked(pruned_marked)
        if pruned_pinned != pinned:
            save_pinned(pruned_pinned)
        start_daemon_detached()
        return 0

    if args.op == "cycle-panel":
        mode = load_panel_mode()
        mode = PANEL_MODES[(PANEL_MODES.index(mode) + 1) % len(PANEL_MODES)]
        save_panel_mode(mode)
        sync_view(True)
        # If another owner (herdr-snooze, while an agent is snoozed) holds
        # the view, sync_view deferred to it: it composes the panel from
        # panel-mode on its tick, so nudge a tick to land the cycle now.
        probe = request("agent.view.clear", {"source": f"{SOURCE}.probe"})
        result = probe.get("result")
        owner = result.get("source") if isinstance(result, dict) and result.get("active") else None
        if isinstance(owner, str) and owner and owner not in (SOURCE, LEGACY_SOURCE):
            try:
                subprocess.run(
                    [sys.executable, str(Path(__file__).with_name("herdr-snooze.py")), "tick"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=15,
                )
            except Exception:
                pass
        if not notify_daemon():
            start_daemon_detached()
        return 0

    marked = load_marked()
    pinned = load_pinned()
    pane_id = args.pane_id or pane_id_from_context()
    if not pane_id:
        return 0
    marked_changed, pinned_changed = apply_one(pane_id, args.op, marked, pinned)
    if marked_changed:
        save_marked(marked)
    if pinned_changed:
        save_pinned(pinned)
        sync_view(True)
    # A focus change also wakes the daemon even when nothing was marked:
    # the newly focused agent's sort token freezes (and the previously
    # focused one unfreezes) on the daemon's next sync.
    if marked_changed or pinned_changed or args.op == "focus":
        if not notify_daemon():
            start_daemon_detached()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
