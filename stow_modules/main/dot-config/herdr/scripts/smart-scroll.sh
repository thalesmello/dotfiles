#!/usr/bin/env python3
"""Smart top/bottom scroll for Herdr TUI and Herdr.app.

Usage:
  smart-scroll.sh top|bottom

In a shell pane, scrolls the terminal scrollback to the top or bottom.
In an agent/TUI pane (such as Pi or Neovim) or nested Herdr session, forwards
super+up / super+down to the pane so the application scrolls its own history.
"""

from __future__ import annotations

import json
import os
import socket
import sys

FORWARD_PROCESS_NAMES = frozenset({"pi", "pi.real", "nvim", "vim", "less"})


def rpc_line(sock_path: str, payload: dict, timeout: float = 1.5) -> dict | None:
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect(sock_path)
        s.sendall((json.dumps(payload) + "\n").encode("utf-8"))
        chunks: list[bytes] = []
        while True:
            chunk = s.recv(65536)
            if not chunk:
                break
            chunks.append(chunk)
            if b"\n" in chunk:
                break
        if not chunks:
            return None
        line = b"".join(chunks).split(b"\n", 1)[0]
        return json.loads(line.decode("utf-8", "replace"))
    except Exception:
        return None
    finally:
        try:
            s.close()
        except Exception:
            pass


def find_herdr_socket() -> str | None:
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


def find_hc_socket() -> str | None:
    for env_key in ("HC_SOCKET", "HC_TERMINAL_SOCKET"):
        val = os.environ.get(env_key)
        if val and os.path.exists(val):
            return val
    session = os.environ.get("HC_SESSION") or "default"
    xdg_state = os.environ.get("XDG_STATE_HOME") or os.path.expanduser("~/.local/state")
    candidate = os.path.join(xdg_state, "herdr-core", session, f"{session}.sock")
    if os.path.exists(candidate):
        return candidate
    return None


def find_herdr_app_socket() -> str | None:
    home = os.environ.get("HERDR_APP_HOME") or os.path.expanduser("~/.config/herdr-app")
    sock = os.path.join(home, "herdr-app.sock")
    return sock if os.path.exists(sock) else None


def strip_transport_prefix(title: str) -> str:
    for prefix in ("[mosh] ", "[et] ", "[ssh] "):
        if title.startswith(prefix):
            title = title[len(prefix) :]
    return title


def title_wants_forward(title: str) -> bool:
    clean = strip_transport_prefix(title or "")
    return "herdr" in clean or clean.startswith("nvim:") or clean.startswith("π ")


def handle_hc(is_top: bool) -> int:
    app_sock = find_herdr_app_socket()
    if not app_sock:
        return 1
    status = rpc_line(app_sock, {"status": True}) or {}
    if status.get("agent") or status.get("overlays"):
        sys.stdout.write("forward\n")
        return 0

    focused_pane = status.get("focused_pane")
    if focused_pane:
        ls_resp = rpc_line(app_sock, {"ls": True}) or {}
        term_addr = None
        term_app = None
        for sp in ls_resp.get("spaces") or []:
            for tb in sp.get("tabs") or []:
                for t_entry in tb.get("terminals") or []:
                    if t_entry.get("pane") == focused_pane or t_entry.get("terminal") == focused_pane:
                        term_addr = t_entry.get("terminal")
                        term_app = t_entry.get("app")
                        break
        if term_app:
            sys.stdout.write("forward\n")
            return 0
        if term_addr and "/" not in str(term_addr):
            hc_sock = find_hc_socket()
            if hc_sock:
                t_resp = rpc_line(
                    hc_sock,
                    {"jsonrpc": "2.0", "id": 1, "method": "terminal.get", "params": {"terminal": term_addr}},
                )
                t_obj = (t_resp or {}).get("result") or {}
                fg_name = os.path.basename(str((t_obj.get("foreground") or {}).get("name") or "")).lower()
                if fg_name in FORWARD_PROCESS_NAMES or title_wants_forward(str(t_obj.get("title") or "")):
                    sys.stdout.write("forward\n")
                    return 0

    rpc_line(app_sock, {"do": "terminal.scroll", "args": {"to": "top" if is_top else "bottom"}})
    return 0


def handle_herdr(is_top: bool) -> int:
    sock = find_herdr_socket()
    if not sock:
        return 1
    pane_id = os.environ.get("HERDR_ACTIVE_PANE_ID") or os.environ.get("HERDR_PANE_ID")
    if pane_id:
        resp = rpc_line(sock, {"id": "1", "method": "pane.get", "params": {"pane_id": pane_id}})
    else:
        resp = rpc_line(sock, {"id": "1", "method": "pane.current", "params": {}})
    pane = ((resp or {}).get("result") or {}).get("pane") or {}
    pane_id = pane.get("pane_id") or pane_id
    if not pane_id:
        return 1

    should_forward = bool(pane.get("agent")) or title_wants_forward(str(pane.get("terminal_title") or ""))
    if not should_forward:
        scroll = pane.get("scroll") or {}
        if int(scroll.get("max_offset_from_bottom") or 0) == 0:
            pinfo_resp = rpc_line(sock, {"id": "2", "method": "pane.process_info", "params": {"pane_id": pane_id}})
            pinfo = ((pinfo_resp or {}).get("result") or {}).get("process_info") or {}
            for proc in pinfo.get("foreground_processes") or []:
                name = os.path.basename(str(proc.get("name") or proc.get("argv0") or "")).lstrip("-").lower()
                if name in FORWARD_PROCESS_NAMES:
                    should_forward = True
                    break

    if should_forward:
        key = "super+up" if is_top else "super+down"
        rpc_line(sock, {"id": "3", "method": "pane.send_keys", "params": {"pane_id": pane_id, "keys": [key]}})
    else:
        offset = 18446744073709551615 if is_top else 0
        rpc_line(sock, {"id": "3", "method": "pane.scroll", "params": {"pane_id": pane_id, "offset_from_bottom": offset}})
    return 0


def main() -> int:
    direction = (sys.argv[1] if len(sys.argv) > 1 else "top").strip().lower()
    is_top = direction in ("top", "up")
    backend = (os.environ.get("HC_PRESET_BACKEND") or "").strip().lower()
    if backend == "hc" or (not backend and not os.environ.get("HERDR_ACTIVE_PANE_ID") and os.environ.get("HERDR_ENV") != "1" and find_herdr_app_socket()):
        return handle_hc(is_top)
    return handle_herdr(is_top)


if __name__ == "__main__":
    sys.exit(main())
