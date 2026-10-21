#!/usr/bin/env python3
"""Event-driven JankyBorders supervisor tied to a yabai process via kqueue."""

from __future__ import annotations

import os
import select
import signal
import subprocess
import sys

BORDERS_ARGV = [
    "/opt/homebrew/bin/borders",
    "style=round",
    "width=6.0",
    "active_color=0xffffffff",
    "inactive_color=0x00000000",
    "hidpi=off",
    "ax_focus=on",
]


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except PermissionError:
        return True
    except OSError:
        return False


def main(argv: list[str]) -> int:
    if len(argv) < 2 or not argv[1].strip():
        return 64
    try:
        yabai_pid = int(argv[1])
    except ValueError:
        return 64
    if yabai_pid <= 0 or not pid_alive(yabai_pid):
        return 0

    try:
        os.setsid()
    except OSError:
        pass

    border_proc: subprocess.Popen[bytes] | None = None

    def cleanup() -> None:
        nonlocal border_proc
        if border_proc is not None and border_proc.poll() is None:
            try:
                border_proc.terminate()
                border_proc.wait(timeout=1.0)
            except Exception:
                try:
                    border_proc.kill()
                    border_proc.wait(timeout=0.5)
                except Exception:
                    pass
        subprocess.run(
            ["/usr/bin/pkill", "-x", "borders"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )

    def handle_signal(_signum: int, _frame: object) -> None:
        raise SystemExit(0)

    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(sig, handle_signal)

    kq = select.kqueue()
    try:
        # Enforce a single JankyBorders instance for this yabai session.
        subprocess.run(
            ["/usr/bin/pkill", "-x", "borders"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        border_proc = subprocess.Popen(BORDERS_ARGV)

        events = [
            select.kevent(
                yabai_pid,
                filter=select.KQ_FILTER_PROC,
                flags=select.KQ_EV_ADD | select.KQ_EV_ENABLE | select.KQ_EV_ONESHOT,
                fflags=select.KQ_NOTE_EXIT,
            ),
            select.kevent(
                border_proc.pid,
                filter=select.KQ_FILTER_PROC,
                flags=select.KQ_EV_ADD | select.KQ_EV_ENABLE | select.KQ_EV_ONESHOT,
                fflags=select.KQ_NOTE_EXIT,
            ),
        ]
        try:
            kq.control(events, 0, 0)
        except ProcessLookupError:
            return 0

        # Block in the kernel with zero polling until yabai or borders exits.
        kq.control(None, 1, None)
        return 0
    finally:
        kq.close()
        cleanup()


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
