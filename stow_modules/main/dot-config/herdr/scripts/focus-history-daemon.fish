#!/usr/bin/env python3
"""Focus-history daemon and recorder for Herdr.

Records every focused pane in order into:
  ${XDG_STATE_HOME:-~/.local/state}/herdr/focus-history/journal

Why both a persistent socket subscriber AND plugin hooks:
* `daemon` subscribes to `pane.focused` over the Unix socket (`socket.AF_UNIX`)
  for sub-millisecond live recording, using kernel `fcntl.flock` on
  `daemon.lock/pid` (never leaves stale locks on crash/SIGKILL) and periodic
  socket inode checks (never hangs on a dead socket after server restart).
* On startup (and on `ensure`), it immediately queries `pane.list` and seeds
  the currently focused pane into `journal` so the pane you start from is
  always recorded before your first focus switch.
* `focus` / `record` can also be invoked directly by Herdr's native
  `[[events]] on = "pane.focused"` plugin hook and by `focus-jumplist.fish`,
  writing under the same `journal.lock` with consecutive-duplicate suppression.
"""

from __future__ import annotations

import fcntl
import json
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

JOURNAL_MAX = 2000
JOURNAL_KEEP = 500
SOCKET_POLL_SECS = 2.0


def state_dir() -> Path:
    base = os.environ.get("XDG_STATE_HOME") or os.path.expanduser("~/.local/state")
    path = Path(base) / "herdr" / "focus-history"
    path.mkdir(parents=True, exist_ok=True)
    return path


def socket_path() -> str | None:
    env_sock = os.environ.get("HERDR_SOCKET_PATH")
    if env_sock and os.path.exists(env_sock):
        return env_sock
    for candidate in (
        os.path.expanduser("~/.config/herdr/herdr.sock"),
        os.path.expanduser("~/.local/state/herdr/herdr.sock"),
    ):
        if os.path.exists(candidate):
            return candidate
    return None


def file_key(path: str | None) -> str | None:
    if not path:
        return None
    try:
        st = os.stat(path)
    except OSError:
        return None
    return f"{path}:{st.st_dev}:{st.st_ino}:{int(st.st_mtime)}"


def request(sock_path: str, method: str, params: dict[str, Any], timeout: float = 2.0) -> dict[str, Any]:
    payload = {
        "id": "focus-history",
        "method": method,
        "params": params,
    }
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    client.settimeout(timeout)
    try:
        client.connect(sock_path)
        client.sendall((json.dumps(payload) + "\n").encode("utf-8"))
        chunks: list[bytes] = []
        while True:
            chunk = client.recv(65536)
            if not chunk:
                break
            chunks.append(chunk)
            if b"\n" in chunk:
                break
    except OSError:
        return {}
    finally:
        try:
            client.close()
        except OSError:
            pass
    if not chunks:
        return {}
    line = b"".join(chunks).split(b"\n", 1)[0]
    try:
        return json.loads(line.decode("utf-8", errors="replace"))
    except Exception:
        return {}


def pane_id_from_context(sock_path: str | None = None) -> str | None:
    for name in ("HERDR_ACTIVE_PANE_ID", "HERDR_PANE_ID"):
        val = os.environ.get(name)
        if val:
            return val
    for name in ("HERDR_PLUGIN_EVENT_JSON", "HERDR_PLUGIN_CONTEXT_JSON"):
        raw = os.environ.get(name)
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except Exception:
            continue
        event_data = data.get("data") if isinstance(data.get("data"), dict) else {}
        for candidate in (
            data.get("focused_pane_id"),
            data.get("pane_id"),
            event_data.get("focused_pane_id"),
            event_data.get("pane_id"),
        ):
            if isinstance(candidate, str) and candidate:
                return candidate
    return query_focused_pane(sock_path or socket_path())


def query_focused_pane(sock_path: str | None) -> str | None:
    if not sock_path:
        return None
    resp = request(sock_path, "pane.list", {})
    panes = (resp.get("result") or {}).get("panes")
    if not isinstance(panes, list):
        return None
    for pane in panes:
        if isinstance(pane, dict) and pane.get("focused") and isinstance(pane.get("pane_id"), str):
            return pane["pane_id"]
    return None


def record_pane(pane_id: str | None, sdir: Path | None = None) -> bool:
    if not pane_id:
        return False
    pane_id = pane_id.strip()
    if not pane_id:
        return False
    sdir = sdir or state_dir()
    lock_file = sdir / "journal.lock"
    journal = sdir / "journal"
    seq_file = sdir / "seq"
    with lock_file.open("a+", encoding="utf-8") as lf:
        fcntl.flock(lf.fileno(), fcntl.LOCK_EX)
        try:
            lines: list[str] = []
            if journal.is_file():
                lines = [ln.strip() for ln in journal.read_text(encoding="utf-8", errors="replace").splitlines() if ln.strip()]
            if lines and lines[-1] == pane_id:
                return False
            lines.append(pane_id)
            if len(lines) > JOURNAL_MAX:
                lines = lines[-JOURNAL_KEEP:]
                tmp = sdir / "journal.tmp"
                tmp.write_text("\n".join(lines) + "\n", encoding="utf-8")
                os.replace(tmp, journal)
            else:
                with journal.open("a", encoding="utf-8") as jf:
                    jf.write(pane_id + "\n")
            try:
                seq = int(seq_file.read_text(encoding="utf-8").strip())
            except Exception:
                seq = 0
            seq_file.write_text(f"{seq + 1}\n", encoding="utf-8")
            return True
        finally:
            fcntl.flock(lf.fileno(), fcntl.LOCK_UN)


def sync_socket_state(sdir: Path, sock_path: str | None) -> bool:
    """Ensure socket-key matches current Herdr socket; reset stale session state if changed."""
    current_key = file_key(sock_path)
    if not current_key:
        return False
    key_file = sdir / "socket-key"
    try:
        recorded_key = key_file.read_text(encoding="utf-8").strip()
    except OSError:
        recorded_key = ""
    if recorded_key != current_key:
        lock_file = sdir / "journal.lock"
        with lock_file.open("a+", encoding="utf-8") as lf:
            fcntl.flock(lf.fileno(), fcntl.LOCK_EX)
            try:
                (sdir / "journal").write_text("", encoding="utf-8")
                (sdir / "seq").write_text("0\n", encoding="utf-8")
                for stale_name in ("walk", "walk-state"):
                    try:
                        (sdir / stale_name).unlink()
                    except OSError:
                        pass
                key_file.write_text(current_key + "\n", encoding="utf-8")
            finally:
                fcntl.flock(lf.fileno(), fcntl.LOCK_UN)
        return True
    return False


def lock_pid_path(sdir: Path) -> Path:
    lock_dir = sdir / "daemon.lock"
    if lock_dir.is_file():
        lock_dir.unlink()
    lock_dir.mkdir(parents=True, exist_ok=True)
    return lock_dir / "pid"


def running_daemon_pid(sdir: Path) -> int | None:
    pid_path = sdir / "daemon.lock" / "pid"
    if not pid_path.is_file():
        return None
    try:
        pid = int(pid_path.read_text(encoding="utf-8").strip())
    except Exception:
        return None
    if pid <= 0:
        return None
    try:
        os.kill(pid, 0)
    except OSError:
        return None
    try:
        with pid_path.open("a+", encoding="utf-8") as lf:
            fcntl.flock(lf.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            fcntl.flock(lf.fileno(), fcntl.LOCK_UN)
            # If we could acquire the exclusive lock, no daemon holds it.
            return None
    except OSError:
        return pid


def daemon_healthy(sdir: Path, sock_path: str | None) -> bool:
    pid = running_daemon_pid(sdir)
    if not pid:
        return False
    current_key = file_key(sock_path)
    if not current_key:
        return False
    try:
        recorded_key = (sdir / "socket-key").read_text(encoding="utf-8").strip()
    except OSError:
        return False
    return recorded_key == current_key


def stop_daemon(sdir: Path) -> None:
    pid_path = sdir / "daemon.lock" / "pid"
    try:
        pid = int(pid_path.read_text(encoding="utf-8").strip())
    except Exception:
        pid = None
    if pid and pid > 0 and pid != os.getpid():
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass
        deadline = time.monotonic() + 1.0
        while time.monotonic() < deadline:
            try:
                os.kill(pid, 0)
            except OSError:
                break
            time.sleep(0.02)
        else:
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass


def spawn_daemon_detached() -> None:
    subprocess.Popen(
        [sys.executable, os.path.realpath(__file__), "daemon"],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def ensure_daemon(seed_pane: str | None = None) -> int:
    sdir = state_dir()
    sock_path = socket_path()
    if not sock_path:
        return 1

    if not daemon_healthy(sdir, sock_path):
        stop_daemon(sdir)
        sync_socket_state(sdir, sock_path)
        if not (sdir / "started").is_file():
            (sdir / "started").write_text(f"{int(time.time())}\n", encoding="utf-8")
        initial = seed_pane or query_focused_pane(sock_path) or pane_id_from_context(sock_path)
        if initial:
            record_pane(initial, sdir)
        spawn_daemon_detached()
        return 0

    # Even when already running, ensure the journal is seeded if empty.
    journal = sdir / "journal"
    if seed_pane:
        record_pane(seed_pane, sdir)
    elif not journal.is_file() or journal.stat().st_size == 0:
        initial = query_focused_pane(sock_path) or pane_id_from_context(sock_path)
        if initial:
            record_pane(initial, sdir)
    return 0


def run_daemon() -> int:
    sdir = state_dir()
    sock_path = socket_path()
    if not sock_path:
        return 1

    pid_path = lock_pid_path(sdir)
    lock_fh = pid_path.open("a+", encoding="utf-8")
    try:
        fcntl.flock(lock_fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return 0

    sync_socket_state(sdir, sock_path)
    expected_key = file_key(sock_path)
    if expected_key:
        (sdir / "socket-key").write_text(expected_key + "\n", encoding="utf-8")
    (sdir / "started").write_text(f"{int(time.time())}\n", encoding="utf-8")
    with (sdir / "restarts.log").open("a", encoding="utf-8") as rf:
        rf.write(time.strftime("%Y-%m-%d %H:%M:%S start\n"))

    lock_fh.seek(0)
    lock_fh.truncate()
    lock_fh.write(f"{os.getpid()}\n")
    lock_fh.flush()

    initial = query_focused_pane(sock_path)
    if initial:
        record_pane(initial, sdir)

    subscribe_msg = (
        json.dumps(
            {
                "id": "focus-history",
                "method": "events.subscribe",
                "params": {"subscriptions": [{"type": "pane.focused"}]},
            }
        )
        + "\n"
    ).encode("utf-8")

    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    client.settimeout(SOCKET_POLL_SECS)
    try:
        client.connect(sock_path)
        client.sendall(subscribe_msg)
        buf = b""
        while True:
            try:
                chunk = client.recv(65536)
                if not chunk:
                    break
                buf += chunk
                while b"\n" in buf:
                    raw_line, buf = buf.split(b"\n", 1)
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if not line or '"pane_focused"' not in line:
                        continue
                    try:
                        msg = json.loads(line)
                    except Exception:
                        continue
                    if msg.get("event") == "pane_focused" and isinstance(msg.get("pane_id"), str):
                        record_pane(msg["pane_id"], sdir)
            except socket.timeout:
                if file_key(sock_path) != expected_key:
                    break
    except OSError:
        pass
    finally:
        try:
            client.close()
        except OSError:
            pass
        try:
            fcntl.flock(lock_fh.fileno(), fcntl.LOCK_UN)
        except OSError:
            pass
        lock_fh.close()
    return 0


def main(argv: list[str]) -> int:
    op = argv[1] if len(argv) > 1 else "daemon"
    if op in ("daemon", "--daemon"):
        return run_daemon()
    if op in ("ensure", "--ensure", "startup", "--startup"):
        pane = argv[2] if len(argv) > 2 else None
        return ensure_daemon(pane)
    if op in ("focus", "--focus", "event", "--event"):
        pane = argv[2] if len(argv) > 2 else pane_id_from_context()
        return ensure_daemon(pane)
    if op in ("record", "--record-pane"):
        pane = argv[2] if len(argv) > 2 else pane_id_from_context()
        record_pane(pane)
        return 0
    if op in ("restart", "--restart"):
        sdir = state_dir()
        stop_daemon(sdir)
        return ensure_daemon()
    if op == "--record":
        for line in sys.stdin:
            if '"pane_focused"' not in line:
                continue
            try:
                msg = json.loads(line)
            except Exception:
                continue
            if msg.get("event") == "pane_focused" and isinstance(msg.get("pane_id"), str):
                record_pane(msg["pane_id"])
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

