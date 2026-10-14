#!/usr/bin/env python3
"""Restore Herdr agent sidebar titles from durable agent session state.

Herdr live handoff can preserve panes and agent sessions while losing the
terminal title captured from the pane's OSC title sequence. The title is still
recoverable from each agent's durable session store, so this script republishes
it as Herdr pane metadata (`$restored_title`). config.toml renders that token as
a fallback beside `terminal_title_stripped`.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import random
import socket
import time
from typing import Any

SOURCE = "agent-titles"
TOKEN = "restored_title"


def socket_path() -> str:
    return os.environ.get("HERDR_SOCKET_PATH") or os.path.expanduser(
        "~/.config/herdr/herdr.sock"
    )


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
        candidates = [data.get("focused_pane_id"), data.get("pane_id")]
        event_data = data.get("data")
        if isinstance(event_data, dict):
            candidates.append(event_data.get("pane_id"))
        for candidate in candidates:
            if isinstance(candidate, str) and candidate:
                return candidate
    return None


def agents() -> list[dict[str, Any]]:
    response = request("agent.list", {})
    data = (response.get("result") or {}).get("agents")
    return [item for item in data if isinstance(item, dict)] if isinstance(data, list) else []


def latest_pi_title(path: str) -> str | None:
    title: str | None = None
    try:
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                try:
                    entry = json.loads(line)
                except Exception:
                    continue
                if entry.get("type") == "session_info" and isinstance(entry.get("name"), str):
                    candidate = entry["name"].strip()
                    if candidate:
                        title = candidate
    except OSError:
        return None
    return title


def claude_session_paths(session_id: str) -> list[str]:
    escaped = glob.escape(session_id)
    pattern = os.path.expanduser(f"~/.claude/projects/**/*{escaped}.jsonl")
    return sorted(glob.glob(pattern, recursive=True))


def latest_claude_title(session_id: str) -> str | None:
    values: dict[str, str | None] = {
        "aiTitle": None,
        "agentName": None,
        "customTitle": None,
    }
    for path in claude_session_paths(session_id):
        try:
            with open(path, encoding="utf-8") as handle:
                for line in handle:
                    try:
                        entry = json.loads(line)
                    except Exception:
                        continue
                    for key in values:
                        value = entry.get(key)
                        if isinstance(value, str) and value.strip():
                            values[key] = value.strip()
        except OSError:
            continue
    return values["customTitle"] or values["agentName"] or values["aiTitle"]


def title_for(agent: dict[str, Any]) -> str | None:
    session = agent.get("agent_session")
    if not isinstance(session, dict):
        return None
    kind = session.get("kind")
    source_agent = session.get("agent")
    value = session.get("value")
    if source_agent == "pi" and kind == "path" and isinstance(value, str):
        return latest_pi_title(value)
    if source_agent == "claude" and kind == "id" and isinstance(value, str):
        return latest_claude_title(value)
    return None


def report_title(pane_id: str, title: str | None) -> None:
    tokens: dict[str, str | None] = {TOKEN: title}
    params: dict[str, Any] = {
        "pane_id": pane_id,
        "source": SOURCE,
        "tokens": tokens,
    }
    if title:
        params["title"] = title
    else:
        params["clear_title"] = True
    request("pane.report_metadata", params)


def may_gain_title(agent: dict[str, Any]) -> bool:
    session = agent.get("agent_session")
    if not isinstance(session, dict):
        return agent.get("agent") in {"pi", "claude"}
    return session.get("agent") in {"pi", "claude"}


def sync_once(pane_id: str | None = None) -> tuple[int, bool]:
    changed = 0
    pending = False
    for agent in agents():
        pane = agent.get("pane_id")
        if not isinstance(pane, str) or not pane:
            continue
        if pane_id and pane != pane_id:
            continue

        # If the pane still has a live terminal title, prefer it and clear any
        # stale restored fallback. The fallback is only for handoff/restart loss.
        if agent.get("terminal_title_stripped"):
            if (agent.get("tokens") or {}).get(TOKEN) or agent.get("title"):
                report_title(pane, None)
                changed += 1
            continue

        title = title_for(agent)
        if not title:
            pending = pending or may_gain_title(agent)
            if (agent.get("tokens") or {}).get(TOKEN) or agent.get("title"):
                report_title(pane, None)
                changed += 1
            continue

        if (agent.get("tokens") or {}).get(TOKEN) == title and agent.get("title") == title:
            continue
        report_title(pane, title)
        changed += 1
    return changed, pending


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="restore Herdr agent title metadata")
    subparsers = parser.add_subparsers(dest="command")
    sync = subparsers.add_parser("sync")
    sync.add_argument("--pane")
    sync.add_argument("--event", action="store_true")
    sync.add_argument("--wait", type=float, default=0.0)
    sync.add_argument("--status", action="store_true")
    parser.set_defaults(pane=None, event=False, wait=0.0, status=False)
    args = parser.parse_args(argv)

    if args.command not in (None, "sync"):
        return 1

    pane_id = args.pane or (pane_id_from_context() if args.event else None)
    deadline = time.monotonic() + max(args.wait, 0.0)
    changed, pending = sync_once(pane_id)
    while pending and time.monotonic() < deadline:
        time.sleep(0.5)
        more_changed, pending = sync_once(pane_id)
        changed += more_changed

    if args.status:
        print(f"changed={changed} pending={pending}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
