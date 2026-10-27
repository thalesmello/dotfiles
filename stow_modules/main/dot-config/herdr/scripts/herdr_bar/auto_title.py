"""Follow agent task titles while preserving names supplied by the user."""

from __future__ import annotations

import hashlib
import json
import os
import re
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

from . import host
from .client import HerdrClient, HerdrError
from .config import Config, default_state_dir
from .opener import default_socket_path
from .textutil import sanitize, truncate

MAX_SCAN = 2 * 1024 * 1024
SESSION_ID = re.compile(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")


def title_state_dir() -> Optional[Path]:
    directory = default_state_dir()
    socket_path = default_socket_path()
    if not directory:
        return None
    if not socket_path:
        return Path(directory)
    key = hashlib.sha256(os.path.abspath(socket_path).encode()).hexdigest()[:24]
    return Path(directory) / "title-servers" / key


def _title(value: Any) -> str:
    return truncate(" ".join(sanitize(value).split()), 80) if isinstance(value, str) else ""


def _is_slug(value: str) -> bool:
    text = value.strip()
    return bool(text and " " not in text and ("-" in text or "_" in text))


def _opening(content: Any) -> str:
    if isinstance(content, list):
        content = " ".join(
            block["text"] for block in content
            if isinstance(block, dict) and block.get("type") == "text"
            and isinstance(block.get("text"), str)
        )
    if not isinstance(content, str):
        return ""
    command = re.search(r"<command-name>\s*/?([^<\s]+)\s*</command-name>", content)
    if command:
        args = re.search(r"<command-args>(.*?)</command-args>", content, re.S)
        return _title(command[1] + " " + (args[1].strip().split("\n")[0] if args else ""))
    content = re.sub(r"<[a-z][a-z-]*>.*?</[a-z][a-z-]*>", " ", content, flags=re.S)
    return _title(content.strip().split("\n")[0])


def claude_roots() -> List[Path]:
    """Claude config directories to search, the server's own first."""
    roots: List[Path] = []
    for value in [os.environ.get("CLAUDE_CONFIG_DIR") or "~/.claude",
                  *Config.load().claude_config_dirs]:
        root = Path(value).expanduser()
        if root not in roots:
            roots.append(root)
    return roots


def _pi_session_title(path: str) -> str:
    """Read the human session title from a Pi session JSONL file."""
    if not path or not os.path.isfile(path):
        return ""
    latest = ""
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                if "session_info" not in line:
                    continue
                try:
                    entry = json.loads(line)
                except ValueError:
                    continue
                if isinstance(entry, dict) and entry.get("type") == "session_info":
                    name = _title(entry.get("name"))
                    if name:
                        latest = name
    except OSError:
        return ""
    return latest


class TranscriptReader:
    def __init__(self, roots: Optional[Sequence[Path]] = None) -> None:
        self.roots = list(roots) if roots is not None else None
        self.sessions: Dict[str, Dict[str, Any]] = {}

    def _find(self, session_id: str, cwd: str) -> Optional[Path]:
        roots = self.roots if self.roots is not None else claude_roots()
        name = session_id + ".jsonl"
        folder = re.sub(r"[^a-zA-Z0-9]", "-", cwd)
        for root in roots:
            candidate = root / "projects" / folder / name
            try:
                if candidate.is_file():
                    return candidate
            except OSError:
                continue
        for root in roots:
            try:
                found = next((root / "projects").glob("*/" + name), None)
            except OSError:
                continue
            if found is not None:
                return found
        return None

    def title(self, session_id: str, cwd: str) -> str:
        if not SESSION_ID.fullmatch(session_id):
            return ""
        state = self.sessions.setdefault(session_id, {
            "path": None, "offset": 0, "identity": None,
            "custom_title": "", "agent_name": "", "title": "", "opening": "",
            "searched": float("-inf"), "boundary": b"",
        })
        if state["path"] is None:
            if time.monotonic() - state["searched"] < 10:
                return ""
            state["searched"] = time.monotonic()
            state["path"] = self._find(session_id, cwd)
            if state["path"] is None:
                return ""
        try:
            with state["path"].open("rb") as handle:
                info = os.fstat(handle.fileno())
                identity = (info.st_dev, info.st_ino)
                handle.seek(max(0, state["offset"] - 64))
                boundary = handle.read(min(state["offset"], 64))
                if (state["identity"] != identity or info.st_size < state["offset"]
                        or boundary != state["boundary"]):
                    state.update(
                        offset=0, custom_title="", agent_name="", title="", opening="",
                        identity=identity,
                    )
                start = max(state["offset"], info.st_size - MAX_SCAN)
                handle.seek(start)
                data = handle.read(MAX_SCAN)
                end = data.rfind(b"\n")
                if end >= 0:
                    next_offset = start + end + 1
                    handle.seek(max(0, next_offset - 64))
                    state["boundary"] = handle.read(min(next_offset, 64))
        except OSError:
            state.update(path=None, offset=0, custom_title="", agent_name="", title="", opening="")
            return ""
        if end >= 0:
            lines = data[:end].split(b"\n")
            if start > state["offset"]:
                lines = lines[1:]
            state["offset"] = start + end + 1
            for line in lines:
                try:
                    record = json.loads(line)
                except (ValueError, UnicodeError):
                    continue
                if not isinstance(record, dict):
                    continue
                if isinstance(record.get("customTitle"), str):
                    state["custom_title"] = _title(record.get("customTitle")) or state["custom_title"]
                if isinstance(record.get("agentName"), str):
                    candidate_name = _title(record.get("agentName"))
                    if candidate_name and not _is_slug(candidate_name):
                        state["agent_name"] = candidate_name
                if record.get("type") == "ai-title" or isinstance(record.get("aiTitle"), str):
                    state["title"] = _title(record.get("aiTitle")) or state["title"]
                elif record.get("type") == "user" and not state["opening"]:
                    origin, message = record.get("origin"), record.get("message")
                    if (isinstance(origin, dict) and origin.get("kind") == "human"
                            and isinstance(message, dict)):
                        state["opening"] = _opening(message.get("content"))
        return state["custom_title"] or state["agent_name"] or state["title"] or state["opening"]


_PROGRAM_PATH = re.compile(
    r"(?:administrator: )?(?:[a-z]:\\|\\\\)[^\r\n]*\.(?:exe|com|bat|cmd)", re.IGNORECASE)


def _agent_title(agent: Dict[str, Any], pane: Dict[str, Any]) -> str:
    agent_tokens = agent.get("tokens") if isinstance(agent.get("tokens"), dict) else {}
    pane_tokens = pane.get("tokens") if isinstance(pane.get("tokens"), dict) else {}
    # Prefer the agent's human/session title first, before any slug or pane label.
    raw = (
        agent.get("terminal_title_stripped")
        or pane.get("terminal_title_stripped")
        or agent_tokens.get("restored_title")
        or pane_tokens.get("restored_title")
        or agent.get("title")
        or pane.get("title")
    )
    title = _title(raw)
    cwd = agent.get("cwd") or pane.get("cwd") or ""
    folder = Path(cwd).name
    if folder and title.endswith(" | " + folder):
        title = title[:-(len(folder) + 3)].strip()
    generic = (
        "", "codex", "claude", "claude code", "pi",
        folder.casefold(), cwd.casefold(),
    )
    if title.casefold() in generic or _PROGRAM_PATH.fullmatch(title) or _is_slug(title):
        return ""
    return title


_NAME_STRIP = re.compile(r"[^a-z0-9_-]+")


def _default_agent_name(name: Any, kind: Any, cwd: str) -> bool:
    """Whether an agent name is just the one derived from its folder."""
    if not isinstance(name, str) or not name:
        return False
    base = _NAME_STRIP.sub("-", Path(cwd.rstrip("/")).name.lower()).strip("-_")
    if not base or not base[0].isalpha():
        base = "%s-%s" % (kind, base) if base else str(kind)
    base = _NAME_STRIP.sub("-", base).strip("-_")[:32]
    if not base:
        return False
    if name == base:
        return True
    match = re.fullmatch(r"(.+)(-\d{1,2})", name)
    return bool(
        match and int(match[2][1:]) >= 2 and match[1] == base[: 32 - len(match[2])]
    )


def _candidates(
    snapshot: Dict[str, Any],
    owned: Optional[Dict] = None,
    follow_new_sessions: bool = False,
) -> Dict[str, Dict[str, Any]]:
    """Default or plugin-owned tabs with one unambiguously identified agent."""
    owned = owned or {}
    panes = {pane.get("pane_id"): pane for pane in snapshot.get("panes", [])}
    agents_by_tab: Dict[str, list] = {}
    for agent in snapshot.get("agents", []):
        agents_by_tab.setdefault(agent.get("tab_id"), []).append(agent)
    positions: Dict[str, int] = {}
    candidates = {}
    for tab in snapshot.get("tabs", []):
        workspace = tab.get("workspace_id", "")
        positions[workspace] = positions.get(workspace, 0) + 1
        if tab.get("title_conflict"):
            continue
        agents = agents_by_tab.get(tab.get("tab_id"), [])
        if len(agents) != 1:
            continue
        agent = agents[0]
        pane = panes.get(agent.get("pane_id"), {})
        cwd = agent.get("cwd") or pane.get("cwd") or ""
        name = agent.get("name")
        # A slug agent name only counts as a default when it is also the
        # tab's label (a launcher propagated its slug to both); any other
        # non-folder name is a custom name and blocks renaming, as upstream.
        if not pane or pane.get("label") or (
            name
            and not _default_agent_name(name, agent.get("agent"), cwd)
            and not (name == tab.get("label") and _is_slug(str(name)))
        ):
            continue
        session = agent.get("agent_session") or pane.get("agent_session") or {}
        kind = agent.get("agent")
        if kind not in ("claude", "codex", "pi"):
            continue
        suggested = _agent_title(agent, pane)
        session_id = None
        if kind == "pi":
            if isinstance(session, dict) and session.get("kind") == "path":
                session_path = session.get("value")
                if isinstance(session_path, str) and session_path:
                    session_id = session_path
                    if not suggested:
                        suggested = _pi_session_title(session_path)
            if not suggested and not session_id:
                continue
        elif session:
            if (not isinstance(session, dict) or session.get("agent") != kind
                    or session.get("kind") != "id"):
                continue
            session_id = session.get("value")
            if not isinstance(session_id, str) or not SESSION_ID.fullmatch(session_id):
                continue
        elif not (suggested and isinstance(pane.get("terminal_id"), str)
                  and pane["terminal_id"]):
            continue
        identity = [kind, session_id, agent.get("pane_id"), pane.get("terminal_id")]
        previous = owned.get(tab["tab_id"], {})
        if not isinstance(previous, dict):
            previous = {}
        if previous.get("yielded"):
            continue
        tab_label = tab.get("label")
        is_default_or_slug = (
            tab_label in (None, "", str(positions[workspace]))
            or (isinstance(tab_label, str) and (_is_slug(tab_label) or (name and tab_label == name)))
        )
        if not is_default_or_slug:
            old_identity = previous.get("identity")
            identified_later = (session_id is not None and old_identity ==
                                [kind, None, agent.get("pane_id"), pane.get("terminal_id")])
            same_pane = (
                follow_new_sessions
                and isinstance(old_identity, list)
                and len(old_identity) == 4
                and old_identity[2] == agent.get("pane_id")
            )
            if ((old_identity != identity and not identified_later and not same_pane)
                    or previous.get("title") != tab.get("label")):
                continue
        candidates[tab["tab_id"]] = {
            "identity": identity, "agent": kind,
            "suggested": suggested,
            "session": session_id, "pane": agent.get("pane_id"),
            "terminal": pane.get("terminal_id"), "label": tab.get("label"),
            "cwd": cwd,
        }
    return candidates


class AutoTitles:
    def __init__(self) -> None:
        self.configure(Config.load())
        self.reader = TranscriptReader()
        self.owned: Dict[str, Any] = {}
        self.state_dir = title_state_dir()

    def configure(self, config: Config) -> None:
        self.enabled = config.auto_titles and os.environ.get(
            "HERDR_AUTO_TITLE_TRANSCRIPT", "true").lower() not in ("0", "false", "no", "off")
        self.lowercase_titles = config.lowercase_titles
        self.follow_new_sessions = config.follow_new_sessions

    def apply(self, client: HerdrClient, snapshot: Dict[str, Any]) -> Dict[str, Any]:
        if not self.enabled:
            return snapshot
        if self.state_dir is None:
            return self._apply(client, snapshot)
        try:
            return self._persisted_apply(client, snapshot)
        except OSError:
            return snapshot

    def _persisted_apply(self, client: HerdrClient, snapshot: Dict[str, Any]) -> Dict[str, Any]:
        self.state_dir.mkdir(parents=True, exist_ok=True)
        with (self.state_dir / "auto-titles.lock").open("a") as lock:
            try:
                host.lock(lock)
            except BlockingIOError:
                return snapshot
            path = self.state_dir / "auto-titles.json"
            try:
                saved = json.loads(path.read_text())
                self.owned = saved if isinstance(saved, dict) else {}
            except (FileNotFoundError, ValueError):
                self.owned = {}
            before = dict(self.owned)
            staging = path.with_suffix(".tmp")
            result = self._apply(client, snapshot, staging)
            if self.owned != before:
                staging.write_text(json.dumps(self.owned))
                staging.replace(path)
            return result

    def _apply(
        self, client: HerdrClient, snapshot: Dict[str, Any], staging: Optional[Path] = None,
    ) -> Dict[str, Any]:
        tabs = {tab["tab_id"]: tab for tab in snapshot.get("tabs", [])}
        self.owned = {key: value for key, value in self.owned.items()
                      if key in tabs and isinstance(value, dict)}
        for tab_id, record in list(self.owned.items()):
            tab = tabs[tab_id]
            if record.get("yielded") or record.get("title") != tab.get("label"):
                self.owned[tab_id] = {"yielded": True}
        candidates = _candidates(snapshot, self.owned, self.follow_new_sessions)
        live = {candidate["session"] for candidate in candidates.values()}
        self.reader.sessions = {
            key: value for key, value in self.reader.sessions.items() if key in live
        }
        for tab_id, candidate in candidates.items():
            title = candidate["suggested"]
            if not title and candidate["agent"] == "claude" and candidate["session"]:
                title = self.reader.title(candidate["session"], candidate["cwd"])
            if self.lowercase_titles:
                title = title.lower()
            if title == candidate["label"] and tab_id in self.owned:
                self.owned[tab_id] = {"identity": candidate["identity"], "title": title}
            if not title or title == candidate["label"]:
                continue
            try:
                snapshot = client.snapshot()
                if _candidates(snapshot, self.owned, self.follow_new_sessions).get(tab_id) != candidate:
                    continue
                if staging is not None:
                    staging.write_text(json.dumps(self.owned))
                client.rename_tab(tab_id, title)
                self.owned[tab_id] = {"identity": candidate["identity"], "title": title}
            except HerdrError:
                continue
            for tab in snapshot.get("tabs", []):
                if tab.get("tab_id") == tab_id:
                    tab["label"] = title
        return snapshot
