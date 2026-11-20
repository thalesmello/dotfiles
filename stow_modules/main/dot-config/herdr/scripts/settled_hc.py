"""Machine-local Settled archive for Herdr Core (no desktop/merged layout IO).

Only a successful terminal.list(all=true) authorizes negative reconciliation.
The event stream additionally remembers positive facts *in order*, before a
later list/get can lose a short-lived session label. Registry and watch locks
are separate: picker/actions never race the long-lived watcher on JSON writes.
"""
import contextlib
import copy
from datetime import datetime
import fcntl
import glob
import hashlib
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import shlex
import shutil
import socket
import subprocess
import sys
import time
import uuid

_adapter = None
_transcripts = {}
_pi_sessions = {}


def normalize_session(session, agent):
    """One identity for Pi's UUID and exact transcript path; no latest-session guess."""
    if agent != "pi" or not isinstance(session, dict) or not session.get("value"):
        return copy.deepcopy(session)
    value = session["value"]
    if session.get("kind") == "path":
        if os.path.isfile(value):
            return {**session, "value": os.path.realpath(value)}
        # Older argv capture marked `pi --session <UUID>` as a path. Pi accepts
        # both IDs and paths for that flag; repair only a proven UUID alias.
        try:
            uuid.UUID(value)
        except (ValueError, TypeError, AttributeError):
            return dict(session)
        session = {**session, "kind": "id"}
    if session.get("kind") != "id":
        return dict(session)
    cached = _pi_sessions.get(value)
    if cached and os.path.isfile(cached):
        return {**session, "kind": "path", "value": cached}
    matches = []
    for path in glob.glob(str(Path.home() / ".pi/agent/sessions" / "*" / ("*" + glob.escape(value) + "*.jsonl"))):
        try:
            with open(path, encoding="utf-8") as handle:
                header = json.loads(handle.readline(65536))
            if isinstance(header, dict) and header.get("type") == "session" and header.get("id") == value:
                matches.append(os.path.realpath(path))
        except (OSError, ValueError):
            continue
    matches = list(set(matches))
    if len(matches) == 1:
        _pi_sessions[value] = matches[0]
        return {**session, "kind": "path", "value": matches[0]}
    return dict(session)  # missing/ambiguous references remain exact, never guessed


def normalize_registry(state):
    out = copy.deepcopy(state)
    aliases = {}
    for bucket in ("seen", "settled", "forgotten"):
        merged = {}
        for key, entry in (state.get(bucket) or {}).items():
            if not isinstance(entry, dict):
                continue
            item = {**entry, "session": normalize_session(entry.get("session") or {}, entry.get("agent"))}
            normalized = item["session"].get("value") or key
            aliases[key] = normalized
            prior = merged.get(normalized)
            if prior:
                # Keep the newest terminal metadata, but the first archive time.
                newer, older = (item, prior) if item.get("created_ms", 0) >= prior.get("created_ms", 0) else (prior, item)
                item = {**older, **newer}
                stamps = [e["settled_at"] for e in (prior, entry) if e.get("settled_at") is not None]
                if stamps:
                    item["settled_at"] = min(stamps)
            merged[normalized] = item
        out[bucket] = merged
    out["pending"] = {aliases.get(key, key): value for key, value in (state.get("pending") or {}).items()}
    return out


def resolve_key(state, key):
    if key in state.get("settled", {}) or key in state.get("seen", {}):
        return key
    return normalize_session({"kind": "path" if os.path.isabs(key) else "id", "value": key}, "pi")["value"]


class CoreError(RuntimeError):
    def __init__(self, message, kind=None):
        super().__init__(message)
        self.kind = kind


def adapter():
    # Independent of snooze_hc: that adapter may not be installed/committed.
    global _adapter
    if _adapter is None:
        candidates = [Path(__file__).resolve().parents[5] / "bin/hc-preset",
                      Path.home() / "src/dotfiles/bin/hc-preset"]
        found = shutil.which("hc-preset")
        if found:
            candidates.append(Path(found))
        path = next((p for p in candidates if p.is_file()), None)
        if path is None:
            raise CoreError("hc-preset is not installed")
        loader = importlib.machinery.SourceFileLoader("_settled_hc_preset", str(path))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        _adapter = importlib.util.module_from_spec(spec)
        loader.exec_module(_adapter)
    return _adapter


def enabled():
    forced = os.environ.get("HC_PRESET_BACKEND", "").lower()
    if forced in ("hc", "herdr"):
        return forced == "hc"
    # Explicit legacy hooks retain their old transport; ordinary CLI execution
    # must discover this machine's Core, including Linux runtime sockets.
    if os.environ.get("HERDR_SOCKET_PATH") or os.environ.get("HERDR_ENV") == "1":
        return adapter().detect_backend() == "hc"
    if socket_path():
        return True
    return adapter().detect_backend() == "hc"


def socket_path():
    # Linux Core puts its socket under XDG_RUNTIME_DIR, not its durable state
    # directory. Never fall through to a different HC_SESSION's default socket.
    for key in ("HC_SOCKET", "HC_TERMINAL_SOCKET"):
        if os.environ.get(key):
            return os.environ[key]
    session = os.environ.get("HC_SESSION") or "default"
    if session in (".", "..") or "/" in session or "\\" in session:
        raise CoreError("Invalid HC_SESSION for Core socket")
    runtime = os.environ.get("XDG_RUNTIME_DIR")
    if runtime:
        candidate = Path(runtime) / "herdr-core" / (session + ".sock")
        if candidate.exists():
            return str(candidate)
    return adapter().hc_socket_path()


def rpc(method, params=None, timeout=5):
    try:
        path = socket_path()
        if not path:
            raise CoreError("Local Core socket unavailable")
        reply = adapter().unix_rpc_line(path, {"jsonrpc": "2.0", "id": 1,
                                              "method": method, "params": params or {}}, timeout=timeout)
    except Exception as exc:
        # The transport deliberately raises on failed mutations. Do not retry
        # an uncertain terminal.run, but do retain a definite conflict's kind.
        if isinstance(exc, CoreError):
            raise
        raise CoreError(str(exc)) from exc
    return result(reply)


def result(reply):
    if not isinstance(reply, dict) or not isinstance(reply.get("result"), dict) or reply.get("error"):
        error = (reply or {}).get("error") if isinstance(reply, dict) else None
        kind = (error or {}).get("kind") or ((error or {}).get("data") or {}).get("kind")
        raise CoreError(str(error or "No successful reply from local Herdr Core"), kind)
    return reply["result"]


def namespace():
    session = os.environ.get("HC_SESSION") or "default"
    if session in (".", "..") or "/" in session or "\\" in session:
        raise CoreError("Invalid HC_SESSION for Settled registry")
    explicit = os.environ.get("HC_SOCKET") or os.environ.get("HC_TERMINAL_SOCKET")
    if explicit:
        state = Path(os.environ.get("XDG_STATE_HOME") or str(Path.home() / ".local/state"))
        canonical = [state / "herdr-core" / session / (session + ".sock")]
        if os.environ.get("XDG_RUNTIME_DIR"):
            canonical.append(Path(os.environ["XDG_RUNTIME_DIR"]) / "herdr-core" / (session + ".sock"))
        selected = os.path.realpath(explicit)
        if selected not in [os.path.realpath(p) for p in canonical]:
            session += "-socket-" + hashlib.sha256(selected.encode()).hexdigest()[:12]
    return session


def state_dir():
    root = os.environ.get("SETTLED_STATE_DIR")
    if not root:
        root = str(Path(os.environ.get("XDG_STATE_HOME", str(Path.home() / ".local/state"))) /
                   "herdr-core/settled")
    return str(Path(root) / namespace())


def registry_path():
    return str(Path(state_dir()) / "registry.json")


def read_registry():
    path = Path(registry_path())
    try:
        data = json.loads(path.read_text())
    except FileNotFoundError:
        data = {}
    except (OSError, ValueError) as exc:
        # Corruption is not an empty archive, and must not be overwritten.
        raise CoreError("Cannot read Settled registry: %s" % exc) from exc
    if not isinstance(data, dict):
        raise CoreError("Invalid Settled registry")
    return normalize_registry({**{k: data.get(k) if isinstance(data.get(k), dict) else {}
                                  for k in ("settled", "seen", "forgotten", "pending")},
                               "legacy_migrated": bool(data.get("legacy_migrated"))})


def migrate_legacy(state):
    """One-time local archive import, never legacy live/store reconciliation."""
    if state.get("legacy_migrated"):
        return state
    base = Path(os.environ.get("XDG_STATE_HOME", str(Path.home() / ".local/state")))
    path = base / "herdr/plugins/herdr-settled" / ((os.environ.get("HC_SESSION") or "default") + ".json")
    try:
        legacy = json.loads(path.read_text()).get("settled") or {}
    except FileNotFoundError:
        legacy = {}
    except (OSError, ValueError, AttributeError) as exc:
        raise CoreError("Cannot import legacy Settled archive: %s" % exc) from exc
    for conv, entry in legacy.items():
        if not isinstance(entry, dict) or conv in state["forgotten"]:
            continue
        session = entry.get("session") or {}
        value, agent = session.get("value"), entry.get("agent")
        resolved = []
        if session.get("kind") == "path" and isinstance(value, str):
            resolved = [value]
        elif session.get("kind") == "id" and isinstance(value, str) and value:
            patterns = {"pi": ".pi/agent/sessions/*/*%s*.jsonl",
                        "claude": ".claude/projects/*/%s.jsonl",
                        "codex": ".codex/sessions/*/*/*/rollout-*-%s.jsonl"}
            if agent in patterns:
                resolved = glob.glob(str(Path.home() / (patterns[agent] % glob.escape(value))))
        if any(os.path.isfile(p) for p in resolved) and agent in ("pi", "claude", "codex"):
            state["settled"].setdefault(conv, {**entry, "imported_from": "legacy-local"})
    state["legacy_migrated"] = True
    return state


def write_registry(state):
    path = Path(registry_path())
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name("registry.%s.tmp" % uuid.uuid4().hex)
    try:
        with tmp.open("w") as handle:
            json.dump(normalize_registry(state), handle, indent=1, sort_keys=True)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    finally:
        with contextlib.suppress(FileNotFoundError):
            tmp.unlink()


@contextlib.contextmanager
def registry_lock():
    Path(state_dir()).mkdir(parents=True, exist_ok=True)
    with open(Path(state_dir()) / "registry.lock", "a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        yield


def local(terminal):
    address = terminal.get("address")
    return isinstance(address, str) and bool(address) and "/" not in address


def layout():
    response = rpc("doc.get", {"name": "herdr-app"})
    value, version = response.get("value"), response.get("version")
    if version is None or (value is not None and not isinstance(value, dict)):
        raise CoreError("Local herdr-app document is unavailable/invalid")
    doc = copy.deepcopy(value) if value is not None else {"spaces": []}
    if not isinstance(doc.get("spaces", []), list):
        raise CoreError("Invalid local herdr-app spaces")
    return doc, version


def nodes(root):
    if not isinstance(root, dict):
        return
    yield root
    for child in root.get("children") or []:
        yield from nodes(child)


def identities(doc):
    by_terminal, by_tab = {}, {}
    for space in doc.get("spaces") or []:
        for tab in space.get("tabs") or []:
            identity = {"workspace_id": space.get("id") or "",
                        "workspace_label": space.get("name") or "",
                        "space_id": space.get("id") or "", "space_name": space.get("name") or "",
                        "tab_id": tab.get("id") or "", "tab_label": tab.get("name") or "",
                        "tab_name": tab.get("name") or ""}
            by_tab[identity["tab_id"]] = identity
            for node in nodes(tab.get("root")):
                terminal = (node.get("content") or {}).get("terminal")
                if isinstance(terminal, str) and "/" not in terminal:
                    by_terminal[terminal] = identity
    return by_terminal, by_tab


def foreground_argv(terminal, agent):
    """Never return a shell wrapper as an agent invocation.

    Prefer OS foreground argv. Direct root launches survive finished terminals;
    node-based Pi installs can expose the interpreter plus their CLI file.
    """
    fg = terminal.get("foreground") or {}
    for argv in (fg.get("argv") or [], terminal.get("argv") or []):
        if not argv or not all(isinstance(v, str) for v in argv):
            continue
        base = os.path.basename(argv[0]).removesuffix(".real")
        if base in (agent, "claude-code" if agent == "claude" else agent):
            return list(argv)
        if agent == "pi" and base in ("node", "nodejs") and len(argv) > 1:
            if "pi-coding-agent" in argv[1] and argv[1].endswith(("/cli.js", "/index.js")):
                return ["pi"] + list(argv[2:])
    return []


def exact_argv_session(argv, agent="pi"):
    for i, token in enumerate(argv[1:], 1):
        flag, sep, inline = token.partition("=")
        selectors = ("--session", "--session-id") if agent == "pi" else ("--resume", "-r") if agent == "claude" else ("resume",)
        if flag in selectors:
            value = inline if sep else (argv[i + 1] if i + 1 < len(argv) else "")
            if value and not value.startswith("-"):
                path = agent == "pi" and flag == "--session" and (os.path.isabs(value) or "/" in value or value.endswith(".jsonl"))
                return {"kind": "path" if path else "id", "value": value, "source": "core-argv"}
    return None


def pi_info(path):
    """Stream metadata only, once per stat; no most-recent transcript guesses."""
    try:
        stat = path.stat()
        signature = (stat.st_mtime_ns, stat.st_size)
        cached = _transcripts.get(str(path))
        if cached and cached[0] == signature:
            return cached[1]
        info = {"name": "", "cwd": "", "timestamp_ms": None}
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                # Skip message bodies without deserializing giant tool outputs.
                if not any('"type":"%s"' % kind in line or '"type": "%s"' % kind in line
                           for kind in ("session", "session_info")):
                    continue
                try:
                    item = json.loads(line)
                except ValueError:
                    continue
                if item.get("type") == "session":
                    info["cwd"] = item.get("cwd") or ""
                    try:
                        info["timestamp_ms"] = datetime.fromisoformat(item["timestamp"].replace("Z", "+00:00")).timestamp() * 1000
                    except (KeyError, ValueError, TypeError):
                        pass
                elif item.get("type") == "session_info":
                    info["name"] = item.get("name") or ""
        _transcripts[str(path)] = (signature, info)
        return info
    except OSError:
        return None


def backfill(terminal, identity):
    """Old Pi integrations lack labels. Require UNIQUE name + cwd + time.

    Finished shells additionally must have reported an agent. Live sessions
    must have a positively identified Pi foreground. Search only this cwd's
    Pi session directory, and verify the session header's cwd too.
    """
    declared = (terminal.get("labels") or {}).get("agent.kind")
    if declared and declared != "pi":
        return None
    live = terminal.get("state") == "live"
    if live and not foreground_argv(terminal, "pi"):
        return None
    if not live and (terminal.get("state") != "finished" or not terminal.get("reported")):
        return None
    cwd = (terminal.get("foreground") or {}).get("cwd") or terminal.get("cwd") or ""
    titles = {v for v in (terminal.get("title"), identity.get("tab_label")) if v}
    if not cwd or not titles or terminal.get("created_ms") is None:
        return None
    end = time.time() * 1000 if live else terminal.get("finished_ms")
    if end is None:
        return None
    directory = Path.home() / ".pi/agent/sessions" / ("--" + cwd.strip("/").replace("/", "-") + "--")
    matches = []
    for path in directory.glob("*.jsonl"):
        info = pi_info(path)
        if (info and info["cwd"] == cwd and info["name"] in titles and
                info["timestamp_ms"] is not None and
                terminal["created_ms"] <= info["timestamp_ms"] <= end):
            matches.append(str(path))
    if len(matches) == 1:
        return {"kind": "path", "value": matches[0], "source": "core-backfill"}
    return None


def record(terminal, doc, seen):
    if not local(terminal) or terminal.get("created_ms") is None:
        return None
    labels = terminal.get("labels") or {}
    by_terminal, by_tab = identities(doc)
    identity = by_terminal.get(terminal["address"]) or by_tab.get(labels.get("herdr.tab")) or {}
    agent = labels.get("agent.kind") or ""
    session = None
    value, kind = labels.get("agent.session"), labels.get("agent.session_kind")
    if value and kind in ("path", "id") and agent:
        session = {"kind": kind, "value": value, "source": "core-labels"}
    previous = [r for r in seen.values() if r.get("terminal_id") == terminal["address"] and
                r.get("created_ms") == terminal["created_ms"]]
    # Once exact labels clear, do not revive them from stale argv or titles.
    had_labels = any((r.get("session") or {}).get("source") == "core-labels" for r in previous)
    if session is None and not had_labels:
        for candidate in ("pi", "claude", "codex"):
            argv = foreground_argv(terminal, candidate)
            session = exact_argv_session(argv, candidate) if argv else None
            if session:
                agent = candidate
                break
        if session is None and (not previous or all((r.get("session") or {}).get("source") == "core-backfill" for r in previous)):
            session = backfill(terminal, identity)
            if session:
                agent = "pi"
    if not session:
        return None
    session = normalize_session(session, agent)
    old = seen.get(session["value"]) or {}
    same = (old.get("terminal_id"), old.get("created_ms"), old.get("session", {}).get("value")) == (
        terminal["address"], terminal["created_ms"], session["value"])
    remembered = old if same else {}
    argv = foreground_argv(terminal, agent) or remembered.get("argv") or []
    fg = terminal.get("foreground") or {}
    # Preserve layout/name even when native close already removed the tab.
    out = {**remembered, **{k: v for k, v in identity.items() if v},
           "agent": agent, "session": session, "argv": argv,
           "terminal_id": terminal["address"], "pane_id": terminal["address"],
           "created_ms": terminal["created_ms"],
           "cwd": fg.get("cwd") or remembered.get("cwd") or terminal.get("cwd") or "",
           "last_status": (terminal.get("status") or {}).get("state") or remembered.get("last_status") or ""}
    out.setdefault("workspace_id", labels.get("herdr.space") or "")
    out.setdefault("space_id", out["workspace_id"])
    out.setdefault("tab_id", labels.get("herdr.tab") or "")
    where_space, _sep, where_tab = str(labels.get("where") or "").partition(" / ")
    out.setdefault("workspace_label", where_space)
    out.setdefault("space_name", out["workspace_label"])
    out.setdefault("tab_label", where_tab)
    out["title"] = terminal.get("title") or remembered.get("title") or out["tab_label"] or agent
    return out


def capture(state, terminals, doc, now=None, reconcile=True):
    """Pure fold; reconcile=True requires a successful all=true list by caller."""
    now = time.time() if now is None else now
    state = normalize_registry(state)
    for name in ("settled", "seen", "forgotten", "pending"):
        state.setdefault(name, {})
    live = set()
    for terminal in terminals:
        if not local(terminal):
            continue
        item = record(terminal, doc, state["seen"])
        if item:
            conv = item["session"]["value"]
            state["seen"][conv] = item
            if terminal.get("state") == "live":
                live.add(conv)
    for conv in live:
        # Pending layout/focus work is not a settled conversation. Keep retry
        # metadata separately so an active agent never remains in the archive.
        pending = state["pending"].get(conv)
        if pending is not None and conv in state["settled"]:
            pending.setdefault("entry", copy.deepcopy(state["settled"][conv]))
        state["settled"].pop(conv, None)
        state["forgotten"].pop(conv, None)  # a genuine live reopen starts a new lifecycle
    if reconcile:
        for conv, item in state["seen"].items():
            if "/" in item.get("terminal_id", "") or conv in live or conv in state["forgotten"]:
                continue
            if conv not in state["settled"]:
                entry = {**item, "settled_at": now}
                # OSC titles may finish on a tool name or shell command. Freeze
                # Pi's durable conversation name once, not on every status flip.
                if item.get("agent") == "pi" and (item.get("session") or {}).get("kind") == "path":
                    info = pi_info(Path(conv))
                    if info and info.get("name"):
                        entry["title"] = info["name"]
                state["settled"][conv] = entry
    return state


def snapshot():
    response = rpc("terminal.list", {"all": True})
    terminals = response.get("terminals")
    if not isinstance(terminals, list):
        raise CoreError("terminal.list(all=true) did not return a terminal snapshot")
    # Remote disconnects/remote terminal IDs are outside this archive's world.
    terminals = [t for t in terminals if isinstance(t, dict) and local(t)]
    doc, _version = layout()
    return terminals, doc


def tick():
    terminals, doc = snapshot()  # never treat transport/doc errors as missing panes
    with registry_lock():
        before = read_registry()
        after = capture(migrate_legacy(copy.deepcopy(before)), terminals, doc)
        if before != after:
            write_registry(after)
    return terminals, doc


def forget(key):
    with registry_lock():
        state = read_registry()
        key = resolve_key(state, key)
        if key not in state["settled"]:
            return "not in the settled registry"
        state["forgotten"][key] = state["settled"].pop(key)
        write_registry(state)
    return "forgot %s" % key


def settle_session(terminal_id, conv):
    if "/" in terminal_id:
        raise CoreError("Settled commands must run on the terminal's own Core")
    tick()
    with registry_lock():
        state = read_registry()
        conv = resolve_key(state, conv)
        entry = state["seen"].get(conv)
        if not entry or entry.get("terminal_id") != terminal_id:
            raise CoreError("No exact remembered session for %s in %s" % (conv, terminal_id))
        state["settled"].setdefault(conv, {**entry, "settled_at": time.time()})
        state["forgotten"].pop(conv, None)
        write_registry(state)
    return "settled %s" % (entry.get("title") or conv)


def settle_pane(terminal_id):
    terminals, _doc = tick()
    terminal = next((t for t in terminals if t["address"] == terminal_id), None)
    if not terminal or terminal.get("state") != "live":
        raise CoreError("No such local live terminal")
    with registry_lock():
        state = read_registry()
        live_record = record(terminal, _doc, state["seen"])
        if not live_record:
            raise CoreError("That terminal has no exact agent session to settle")
        conv = live_record["session"]["value"]
        state["settled"].setdefault(conv, {**live_record, "settled_at": time.time()})
        state["forgotten"].pop(conv, None)
        write_registry(state)  # archive BEFORE close, including if close fails
    # Refuse ID reuse that occurred during capture, rather than killing a new program.
    current = rpc("terminal.get", {"terminal": terminal_id})
    if current.get("created_ms") != terminal["created_ms"]:
        raise CoreError("Terminal identity changed; nothing closed")
    rpc("terminal.kill", {"terminal": terminal_id})
    rpc("terminal.rm", {"terminal": terminal_id})
    return "settled %s" % (live_record.get("title") or conv)


def save_layout(edit, retries=5):
    """Optimistic document update. Only a DEFINITE conflict permits retry."""
    for _ in range(retries):
        doc, version = layout()
        edit(doc)
        # hc-preset raises AdapterError without preserving the kind for doc.set.
        # Its underlying line transport returns the original structured error.
        a = adapter()
        reply = a.unix_rpc_line(socket_path(),
                                {"jsonrpc": "2.0", "id": 1, "method": "doc.set",
                                 "params": {"name": "herdr-app", "value": doc, "version": version}},
                                timeout=5)
        try:
            return result(reply)
        except CoreError as exc:
            if exc.kind != "conflict":
                raise
    raise CoreError("Local herdr-app document kept changing; archive retained")


def request_focus(address):
    # The desktop owns focus; a remote helper cannot access its Unix socket.
    # The personal spaces mod consumes this post-adoption request on whichever
    # screen observes this Core, using that screen's machine-qualified address.
    rpc("terminal.label", {"terminal": address, "labels": {
        "settled.focus_token": uuid.uuid4().hex,
        "settled.focus_at_ms": str(int(time.time() * 1000))}})


def reopen(key, resume_command):
    terminals, doc = snapshot()
    with registry_lock():
        state = read_registry()
        key = resolve_key(state, key)
        pending = copy.deepcopy(state["pending"].get(key))
        entry = copy.deepcopy(state["settled"].get(key) or (pending or {}).get("entry"))
    if entry is None:
        return "not settled anymore"
    existing = None
    for terminal in terminals:
        item = record(terminal, doc, state["seen"])
        if terminal.get("state") == "live" and item and item["session"]["value"] == key:
            existing = terminal
            break
    if existing and not pending and existing["address"] in identities(doc)[0]:
        request_focus(existing["address"])
        with registry_lock():
            state = read_registry()
            state["settled"].pop(key, None)
            write_registry(state)
        return "already open in %s -- focus requested" % existing["address"]
    if not (entry.get("session") or {}).get("value"):
        raise CoreError("Cannot resume without an exact conversation (no most-recent fallback)")
    command = resume_command(entry)
    if not command:
        raise CoreError("No resume command known for %r" % entry.get("agent"))
    cwd = entry.get("cwd") or str(Path.home())
    if not os.path.isdir(cwd):
        raise CoreError("Original cwd no longer exists: %s; archive retained" % cwd)
    if pending and not existing and time.time() - pending.get("started", 0) < 30:
        raise CoreError("A resume is still pending; archive retained. Retry after inspecting its terminal.")
    if not pending or not existing:
        space = next((s for s in doc.get("spaces", []) if s.get("id") == entry.get("workspace_id")), None)
        if space is None and entry.get("workspace_label"):
            space = next((s for s in doc.get("spaces", []) if s.get("name") == entry["workspace_label"]), None)
        pending = {"token": uuid.uuid4().hex, "started": time.time(), "entry": entry,
                   "space_id": space["id"] if space else "sp" + uuid.uuid4().hex,
                   "tab_id": "tb" + uuid.uuid4().hex}
        with registry_lock():
            state = read_registry()
            active = state["pending"].get(key)
            if active and time.time() - active.get("started", 0) < 30:
                raise CoreError("Another resume is pending; archive retained")
            state["pending"][key] = pending
            write_registry(state)  # retain retry metadata even when watcher removes the live row
        try:
            # Direct argv, never a shell wrapper/template/first prompt.
            run = existing if existing else rpc("terminal.run", {"argv": shlex.split(command), "cwd": cwd, "keep": True,
                                      "outlive_parent": True, "no_parent": True, "no_notify": True,
                                      "labels": {"herdr.space": pending["space_id"], "herdr.tab": pending["tab_id"],
                                                 "agent.kind": entry["agent"], "agent.session": entry["session"]["value"],
                                                 "agent.session_kind": entry["session"]["kind"],
                                                 "settled.resume_token": pending["token"],
                                                 "where": (entry.get("workspace_label") or "settled") + " / " +
                                                          (entry.get("title") or "settled")}}, timeout=20)
        except CoreError as exc:
            if exc.kind in ("spawn_failed", "invalid_params", "config", "not_found"):
                with registry_lock():
                    state = read_registry()
                    state["pending"].pop(key, None)
                    write_registry(state)
            raise
    else:
        run = existing  # retry failed adoption without spawning a duplicate agent
    address = run.get("address")
    if (not isinstance(address, str) or not address or "/" in address or
            run.get("state") != "live" or run.get("created_ms") is None or run.get("reason") == "spawn_pending"):
        raise CoreError("Resume did not launch successfully; archive retained")
    def adopt(doc):
        spaces = doc.setdefault("spaces", [])
        destination = next((s for s in spaces if s.get("id") == pending["space_id"]), None)
        if destination is None:
            destination = {"id": pending["space_id"], "name": entry.get("workspace_label") or "settled",
                           "folder": cwd, "tabs": []}
            spaces.append(destination)
        if not any(t.get("id") == pending["tab_id"] for t in destination.get("tabs", [])):
            destination.setdefault("tabs", []).append({
                "id": pending["tab_id"], "name": entry.get("title") or entry.get("tab_label") or "settled",
                "root": {"id": pending["tab_id"], "type": "row", "children": [
                    {"id": "p" + uuid.uuid4().hex, "type": "block", "size": {"weight": 1.0},
                     "content": {"terminal": address}}]}})
    try:
        save_layout(adopt)
    except CoreError as exc:
        raise CoreError("Agent launched in %s, but layout adoption failed: %s; archive retained. "
                        "Retry to adopt this same terminal." % (address, exc)) from exc
    current = rpc("terminal.get", {"terminal": address})
    if current.get("state") != "live" or current.get("created_ms") != run["created_ms"]:
        raise CoreError("Restored agent stopped during startup; archive retained")
    request_focus(address)
    with registry_lock():
        state = read_registry()
        state["settled"].pop(key, None)  # only after launch, durable adoption, and focus request succeed
        state["pending"].pop(key, None)
        state["seen"][key] = {**entry, "terminal_id": address, "pane_id": address,
                              "session": {**entry["session"], "source": "core-labels"},
                              "created_ms": run.get("created_ms"), "argv": shlex.split(command)}
        state["seen"][key].pop("settled_at", None)
        write_registry(state)
    return "reopened in %s" % address


def compat_call(method, params=None, timeout=5):
    params = params or {}
    if method == "pane.list":
        terminals, doc = tick()  # picker reload also captures retained finished records
        seen = read_registry()["seen"]
        panes = []
        for terminal in terminals:
            entry = record(terminal, doc, seen)
            if terminal.get("state") == "live" and entry:
                panes.append({**entry, "agent_session": entry["session"],
                              "agent_status": (terminal.get("status") or {}).get("state") or "",
                              "terminal_title_stripped": entry["title"], "tokens": {}})
        return {"panes": panes}
    if method == "workspace.list":
        doc, _ = layout()
        return {"workspaces": [{"workspace_id": s.get("id"), "label": s.get("name") or ""}
                               for s in doc.get("spaces", [])]}
    raise CoreError("%s is a legacy-only action; not supported by machine-local Settled. "
                    "Use the desktop popup mod to open picker." % method)


def remember(terminal, doc):
    """Positive event facts only. A later successful list reconciles closures."""
    with registry_lock():
        before = read_registry()
        after = capture(before, [terminal], doc, reconcile=False)
        if before != after:
            write_registry(after)


def process_event(event, cache, doc):
    """Apply ordered Core event snapshots/deltas BEFORE asking for newer facts."""
    method = event.get("method")
    if method == "heartbeat":
        return doc
    if method == "missed":
        # Never turn a gap/disconnect into synthetic closures. ensure-watch retries.
        raise CoreError("Core event stream missed facts; watcher exiting for retry")
    if method != "event":
        raise CoreError("Unexpected Core event notification")
    params = event.get("params") or {}
    kind, address, data = params.get("type"), params.get("terminal"), params.get("data") or {}
    if kind == "doc":
        return layout()[0]  # this Core's doc only; no merged desktop layout
    if not isinstance(address, str) or "/" in address:
        return doc
    if kind == "removed":
        cache.pop(address, None)
    else:
        terminal = copy.deepcopy(cache.get(address) or {})
        full = data.get("terminal") if isinstance(data.get("terminal"), dict) else data
        if isinstance(full, dict) and "address" in full and "created_ms" in full:
            terminal = copy.deepcopy(full)
        elif not terminal:
            terminal = rpc("terminal.get", {"terminal": address})
        # Labels notifications carry the COMPLETE labels map, including clears.
        # Keep event labels even if hydration now reports a later cleared session.
        if kind == "labels" and "labels" in data:
            terminal["labels"] = copy.deepcopy(data["labels"])
        elif kind == "title" and "title" in data:
            terminal["title"] = data["title"]
        elif kind == "status" and "status" in data:
            terminal["status"] = data["status"]
        elif kind == "finished":
            terminal["state"] = "finished"
        terminal.setdefault("address", address)
        cache[address] = terminal
        # Hydrate foreground argv without overwriting the ordered labels/title.
        if kind in ("created", "labels") and not foreground_argv(terminal, (terminal.get("labels") or {}).get("agent.kind", "pi")):
            with contextlib.suppress(CoreError):
                fresh = rpc("terminal.get", {"terminal": address})
                if fresh.get("created_ms") == terminal.get("created_ms"):
                    terminal["foreground"] = fresh.get("foreground")
        remember(terminal, doc)
    tick()  # MUST succeed before treating missing/finished/cleared as closed
    return doc


def watch(lock_fd=None, wait_lock=False):
    handle = None
    if lock_fd is None:
        Path(state_dir()).mkdir(parents=True, exist_ok=True)
        handle = open(Path(state_dir()) / "watch.lock", "a")
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | (0 if wait_lock else fcntl.LOCK_NB))
        except BlockingIOError:
            handle.close()
            return 0
    else:
        handle = os.fdopen(lock_fd, "a")  # inherited open file description owns flock
    try:
        # Reconnect transient failures ourselves, including headless operation.
        # Keep the singleton lock throughout; bound outages so stopped scratch
        # Cores do not leave immortal helpers. The desktop can ensure again.
        delay = 0.1
        for attempt in range(16):
            try:
                return watch_stream()
            except (CoreError, OSError, ValueError) as exc:
                print("Settled watcher retry:", exc, flush=True)
                if not Path(state_dir()).exists() or attempt == 15:
                    return 1
                time.sleep(delay)
                delay = min(delay * 2, 5)
    finally:
        handle.close()


def watch_stream():
    sock_path = socket_path()
    if not sock_path:
        raise CoreError("Local Core socket unavailable")
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
        sock.settimeout(30)
        sock.connect(sock_path)
        sock.sendall((json.dumps({"jsonrpc": "2.0", "id": 1, "method": "events.subscribe", "params": {}}) + "\n").encode())
        with sock.makefile("r", encoding="utf-8") as stream:
            first = stream.readline()
            if not first:
                raise CoreError("Core disconnected before event snapshot")
            initial = result(json.loads(first)).get("terminals")
            if not isinstance(initial, list):
                raise CoreError("Core events did not supply a snapshot")
            cache = {t["address"]: t for t in initial if local(t)}
            doc, _ = layout()
            for terminal in cache.values():
                remember(terminal, doc)
            tick()  # seed retained finished entries; subscription is already open
            for line in stream:
                doc = process_event(json.loads(line), cache, doc)
            raise CoreError("Core event stream disconnected; archive preserved")


def ensure_watch(script):
    """Start one hidden, parent-independent Core terminal, not an exec child.

    Remote Core exec scopes can reap even detached OS descendants. Core owns
    this worker directly; the unique name and flock make concurrent ensures
    safe. --wait-lock hands the startup lock to it after terminal.run returns.
    """
    directory = Path(state_dir())
    directory.mkdir(parents=True, exist_ok=True)
    with open(directory / "watch.lock", "a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0
        env = {key: value for key, value in os.environ.items() if key in (
            "HC_SESSION", "HC_SOCKET", "HC_TERMINAL_SOCKET", "SETTLED_STATE_DIR",
            "XDG_STATE_HOME", "XDG_RUNTIME_DIR")}
        env["HC_PRESET_BACKEND"] = "hc"
        try:
            launched = rpc("terminal.run", {
                "argv": [sys.executable, str(script), "watch", "--wait-lock"],
                "name": "settled-watch", "no_parent": True, "outlive_parent": True,
                "no_notify": True, "env": env, "labels": {"settled.watcher": namespace()}}, timeout=20)
        except CoreError as exc:
            if exc.kind == "name_taken":
                return 0  # Another ensure's worker is still acquiring/ending.
            raise
        if launched.get("state") != "live":
            raise CoreError("Settled watcher did not start")
        return 0


def install(legacy):
    """Opt in at CLI dispatch, leaving import-time legacy APIs/tests intact."""
    legacy._hc_mode = True
    legacy.state_dir = state_dir
    legacy.registry_path = registry_path
    legacy.read_registry = read_registry
    legacy.write_registry = write_registry
    legacy.forget = forget
    legacy.settle_pane = settle_pane
    legacy.settle_session = settle_session
    legacy.reopen = lambda key: reopen(key, legacy.resume_command)
    def do_tick():
        try:
            tick()
            return 0
        except (CoreError, OSError, ValueError) as exc:
            legacy.log("tick: local Core unreachable; archive preserved:", exc)
            return 1
    legacy.tick = do_tick
    def call(method, params=None, timeout=5):
        try:
            return compat_call(method, params, timeout)
        except CoreError as exc:
            raise legacy.HerdrError("hc", str(exc)) from exc
    legacy.call = call
