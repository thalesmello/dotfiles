#!/usr/bin/env python3
"""Manual unread marker for Herdr agent panes.

Local, dependency-free reimplementation of the useful bits of
https://github.com/JoanGil/herdr-unread-marker, with two local additions:

* focusing a marked pane clears it (via the local plugin event hook);
* the marker renders in the same sidebar slot as Herdr's normal status glyph.

State is private machine state under $XDG_STATE_HOME/herdr/unread-marker*. The
visible sidebar glyphs are pane metadata tokens, so this script never changes
Herdr's native agent status/seen model.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import random
import select
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

SOURCE = "unread-marker"
MARK_TOKEN = "um_marked"
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
    path = base / "herdr" / f"unread-marker{suffix}"
    if not path.is_dir():
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
        try:
            path.chmod(0o700)
        except OSError:
            pass
    return path


def marked_path() -> Path:
    return state_dir() / "marked.json"


def file_mtime_ns(path: Path) -> int | None:
    try:
        return path.stat().st_mtime_ns
    except OSError:
        return None


def load_marked() -> set[str]:
    try:
        data = json.loads(marked_path().read_text(encoding="utf-8"))
    except Exception:
        return set()
    if isinstance(data, list):
        return {str(item) for item in data if item}
    return set()


def save_marked(marked: set[str]) -> None:
    path = marked_path()
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(sorted(marked), indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


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


def status_name(pane: dict[str, Any]) -> str:
    status = pane.get("agent_status")
    if isinstance(status, str) and status in VISIBLE_TOKENS:
        return status
    return "unknown"


def token_patch(status: str, marked: bool, frame: int = 0) -> dict[str, str | None]:
    tokens: dict[str, str | None] = {name: None for name in VISIBLE_TOKENS.values()}
    # Clear the first version of this script too.
    tokens[LEGACY_TOKEN] = None
    tokens[MARK_TOKEN] = "1" if marked else None
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


def report(pane_id: str, pane: dict[str, Any], marked: bool, frame: int = 0) -> None:
    report_tokens(pane_id, token_patch(status_name(pane), marked, frame))


def apply_one(pane_id: str, op: str, marked: set[str]) -> bool:
    if op in {"unmark", "focus"} and not marked:
        return False
    pane = pane_get(pane_id)
    if not pane:
        return False
    key = pane_key(pane, pane_id)
    is_marked = pane_marked(pane, pane_id, marked)
    if op == "toggle":
        want_marked = not is_marked
    elif op == "mark":
        want_marked = True
    else:  # unmark/focus/sync
        want_marked = False if op in {"unmark", "focus"} else is_marked

    if want_marked == is_marked and op in {"mark", "unmark", "focus"}:
        return False

    if want_marked:
        marked.add(key)
    else:
        marked.discard(key)
    report(pane_id, pane, want_marked, int(time.monotonic() / ANIMATION_SECS))
    return True


def fetch_agents() -> list[dict[str, Any]] | None:
    response = request("agent.list", {})
    agents = (response.get("result") or {}).get("agents")
    if not isinstance(agents, list):
        return None
    return [agent for agent in agents if isinstance(agent, dict)]


def sync_agents(
    agents: list[dict[str, Any]],
    marked: set[str],
    frame: int = 0,
    cache: dict[str, dict[str, str | None]] | None = None,
) -> tuple[set[str], bool]:
    live_keys: set[str] = set()
    live_panes: set[str] = set()
    has_working = False
    for agent in agents:
        pane_id = agent.get("pane_id")
        if not isinstance(pane_id, str) or not pane_id:
            continue
        key = pane_key(agent, pane_id)
        live_keys.add(key)
        live_panes.add(pane_id)
        status = status_name(agent)
        is_marked = pane_marked(agent, pane_id, marked)
        if status == "working" and not is_marked:
            has_working = True
        tokens = token_patch(status, is_marked, frame)
        if cache is None or cache.get(pane_id) != tokens:
            report_tokens(pane_id, tokens)
            if cache is not None:
                cache[pane_id] = tokens
    if cache is not None:
        for pane_id in set(cache) - live_panes:
            cache.pop(pane_id, None)
    # Prune terminals/panes that no longer exist.
    return ({key for key in marked if key in live_keys}, has_working)


def sync_all(
    marked: set[str],
    frame: int = 0,
    cache: dict[str, dict[str, str | None]] | None = None,
) -> set[str]:
    agents = fetch_agents()
    if agents is None:
        return marked
    pruned, _ = sync_agents(agents, marked, frame, cache)
    return pruned


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
    agents: list[dict[str, Any]] | None = None
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

            now = time.monotonic()
            if (
                force_refresh
                or agents is None
                or (now - last_fetch_at) >= AGENT_LIST_REFRESH_SECS
            ):
                fetched = fetch_agents()
                if fetched is not None:
                    agents = fetched
                    last_fetch_at = now
                    force_refresh = False

            if agents is not None:
                pruned, has_working = sync_agents(agents, marked, frame, cache)
                if pruned != marked:
                    marked = pruned
                    save_marked(marked)
                    marked_mtime = file_mtime_ns(marked_path())

            frame = (frame + 1) % len(WORKING_FRAMES)
        except Exception:
            cache.clear()
            agents = None

        timeout = ANIMATION_SECS if has_working else (1.0 if agents is None else None)
        if kq is not None:
            events = kq.control(None, 4, timeout)
            for ev in events:
                if ev.ident == wakeup_r:
                    drain_fd(wakeup_r)
                    force_refresh = True
        else:
            time.sleep(ANIMATION_SECS if has_working else 1.0)
            drain_fd(wakeup_r)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="toggle/sync Herdr unread marker metadata")
    parser.add_argument(
        "op",
        nargs="?",
        default="toggle",
        choices=["toggle", "mark", "unmark", "focus", "sync", "daemon", "restart"],
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
        pruned = sync_all(marked, int(time.monotonic() / ANIMATION_SECS))
        if pruned != marked:
            save_marked(pruned)
        start_daemon_detached()
        return 0

    marked = load_marked()
    pane_id = args.pane_id or pane_id_from_context()
    if not pane_id:
        return 0
    changed = apply_one(pane_id, args.op, marked)
    if changed:
        save_marked(marked)
        notify_daemon()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
