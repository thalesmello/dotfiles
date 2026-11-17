"""Connected-only Settled archives; synchronous service for a threaded picker.

There is no offline cache, merged registry, or local read of a remote transcript.
CLI export-json/preview-json dispatchers should print export_local/preview_local.
The picker may poll connected() independently of a slower snapshot().
"""
from queue import Empty, Queue
import importlib.util
import json
import math
import os
from pathlib import Path
import selectors
import stat
import subprocess
import sys
import threading
import time
import uuid

import settled_hc as hc


class ArchiveError(RuntimeError):
    """Unavailable, stale or malformed owning-machine archive."""


def _identity(timeout=5):
    hello = hc.rpc("hello", timeout=timeout)
    core_id = (hello.get("core") or {}).get("id")
    namespace = hc.namespace()
    if not isinstance(core_id, str) or not core_id or not isinstance(namespace, str) or not namespace:
        raise ArchiveError("Core did not report its archive identity")
    return core_id, namespace


def _transcript(legacy, entry):
    path = legacy.transcript_path(entry)
    if path is None:
        return None, True
    path = os.fspath(path)
    try:
        gone = not stat.S_ISREG(os.stat(path).st_mode)
    except FileNotFoundError:
        gone = True
    return path, gone


def export_local(legacy):
    """Reconcile with this actual Core, then export metadata only (no messages).

    Deliberately not legacy.tick(): its installed wrapper logs and masks failure.
    A failed Core read must fail the export, not advertise an old registry.
    """
    identity = _identity()
    hc.tick()
    state = hc.normalize_registry(hc.read_registry())
    entries = []
    for key, entry in state.get("settled", {}).items():
        path, gone = _transcript(legacy, entry)
        # Launch argv can contain the original prompt or credentials. Actions
        # resolve it on the owning Core; the combined browser does not need it.
        metadata = {k: v for k, v in entry.items() if k != "argv"}
        entries.append({**metadata, "key": key, "transcript": path, "gone": gone})
    if _identity() != identity:
        raise ArchiveError("Core changed during archive export")
    return {"version": 1, "core_id": identity[0], "namespace": identity[1], "entries": entries}


def preview_local(legacy, key):
    """Read only an exact current registry entry on this machine, never row paths."""
    identity = _identity()
    entry = hc.read_registry().get("settled", {}).get(key)
    if entry is None:
        raise ArchiveError("No longer settled: %s" % key)
    path, gone = _transcript(legacy, entry)
    messages = []
    if not gone:
        # tail_messages tolerates IO failures for the legacy picker. Do not turn
        # a known unreadable transcript into a successful empty remote preview.
        with open(path, "rb"):
            pass
        messages = [[role, text] for role, text in legacy.tail_messages(path)]
    if _identity() != identity:
        raise ArchiveError("Core changed during transcript preview")
    return {"messages": messages, "gone": gone}


def _load_legacy():
    name = "_settled_machines_legacy"
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name("herdr-settled.py"))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def action_worker(legacy, action, key, expected_core, expected_namespace, token):
    """A Core-owned process completes mutations even after the picker exits."""
    uuid.UUID(token)
    directory = Path(hc.state_dir()) / "actions"
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / (token + ".json")
    try:
        if _identity() != (expected_core, expected_namespace):
            raise ArchiveError("Stale Settled action: owning Core or namespace changed")
        legacy._hc_mode = True
        if action == "reopen":
            outcome = hc.reopen(key, legacy.resume_command)
        elif action == "forget":
            outcome = hc.forget(key)
        else:
            raise ArchiveError("Unknown archive action")
        result = {"ok": True, "outcome": outcome}
    except Exception as exc:
        result = {"ok": False, "error": str(exc)}
    temporary = path.with_suffix(".tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(result, handle)
    temporary.replace(path)
    return 0 if result["ok"] else 1


def durable_action(legacy, action, key, expected_core, expected_namespace):
    if action not in ("reopen", "forget") or _identity() != (expected_core, expected_namespace):
        raise ArchiveError("Stale or invalid Settled action")
    token = uuid.uuid4().hex
    path = Path(hc.state_dir()) / "actions" / (token + ".json")
    env = {k: v for k, v in os.environ.items() if k in (
        "HC_SESSION", "HC_SOCKET", "HC_TERMINAL_SOCKET", "SETTLED_STATE_DIR",
        "XDG_STATE_HOME", "XDG_RUNTIME_DIR")}
    env["HC_PRESET_BACKEND"] = "hc"
    job = hc.rpc("terminal.run", {
        "argv": [sys.executable, str(Path(__file__).with_name("herdr-settled.py")),
                 "action-worker-json", action, key, expected_core, expected_namespace, token],
        "no_parent": True, "outlive_parent": True, "no_notify": True, "rm": True,
        "env": env, "labels": {"settled.action": token}}, timeout=20)
    address = job.get("address")
    if not isinstance(address, str) or "/" in address:
        raise ArchiveError("Settled action did not start on the owning Core")
    try:
        waited = hc.rpc("terminal.wait", {"terminal": address, "timeout": 60}, timeout=65)
        if not waited.get("ended"):
            raise ArchiveError("Settled action is still running; do not retry before checking it")
    except hc.CoreError:
        # An rm worker may already have finished and been removed before wait.
        if not path.is_file():
            raise
    if _identity() != (expected_core, expected_namespace):
        raise ArchiveError("Core changed while waiting for Settled action")
    try:
        result = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ArchiveError("Settled action finished without a result; inspect before retrying") from exc
    path.unlink(missing_ok=True)
    if not isinstance(result, dict) or type(result.get("ok")) is not bool:
        raise ArchiveError("Invalid action result")
    if not result["ok"]:
        raise ArchiveError(str(result.get("error") or "Action failed"))
    if not isinstance(result.get("outcome"), str):
        raise ArchiveError("Invalid action outcome")
    return result["outcome"]


# The checked CLI command runs in the SAME process as the identity check, on
# the owning Core's environment. No separate check-then-reroute hc invocation.
# Arguments (including registry keys) are positional, never interpolated code.
_OWNER_COMMAND = '''import importlib.util, os, sys
script, expected_core, expected_namespace, command, key = sys.argv[1:]
sys.path.insert(0, os.path.dirname(script))
import settled_hc as hc
spec = importlib.util.spec_from_file_location("_settled_owner_cli", script)
legacy = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = legacy
spec.loader.exec_module(legacy)
hc.install(legacy)
hello = hc.rpc("hello")
if (hello.get("core") or {}).get("id") != expected_core or hc.namespace() != expected_namespace:
    raise RuntimeError("Stale Settled row: owning Core or namespace changed")
if command in ("reopen", "forget"):
    import settled_machines
    print(settled_machines.durable_action(legacy, command, key, expected_core, expected_namespace))
else:
    sys.exit(legacy.main([command, key]))
'''
_SHELL_EXPORT = '''export PATH="$HOME/.local/bin:$PATH"
export HC_PRESET_BACKEND=hc
exec python3 "$HOME/.config/herdr/scripts/herdr-settled.py" "$@"
'''
_SHELL_OWNER = '''export PATH="$HOME/.local/bin:$PATH"
export HC_PRESET_BACKEND=hc
exec python3 -c "$1" "$HOME/.config/herdr/scripts/herdr-settled.py" "$2" "$3" "$4" "$5"
'''


def _run_bounded(argv, timeout, max_bytes):
    """Bound wall time AND output; kill/reap failed transports, never retry."""
    process = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    buffers = {"stdout": bytearray(), "stderr": bytearray()}
    deadline = time.monotonic() + timeout
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ, "stdout")
            selector.register(process.stderr, selectors.EVENT_READ, "stderr")
            total = 0
            while selector.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise ArchiveError("Archive transport timed out")
                for item, _events in selector.select(remaining):
                    chunk = os.read(item.fd, 65536)
                    if not chunk:
                        selector.unregister(item.fileobj)
                        continue
                    total += len(chunk)
                    if total > max_bytes:
                        raise ArchiveError("Archive transport exceeded output limit")
                    buffers[item.data].extend(chunk)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ArchiveError("Archive transport timed out")
            code = process.wait(timeout=remaining)
        if code:
            error = buffers["stderr"].decode("utf-8", "replace").strip()
            raise ArchiveError("Archive command failed (%s): %s" % (code, error[:2000]))
        return buffers["stdout"].decode("utf-8")
    except subprocess.TimeoutExpired as exc:
        raise ArchiveError("Archive transport timed out; outcome may be uncertain") from exc
    finally:
        if process.poll() is None:
            process.kill()
        process.wait()
        process.stdout.close()
        process.stderr.close()


def _validate_export(data):
    if not isinstance(data, dict) or type(data.get("version")) is not int or data["version"] != 1:
        raise ArchiveError("Invalid archive export version")
    for field in ("core_id", "namespace"):
        if not isinstance(data.get(field), str) or not data[field]:
            raise ArchiveError("Invalid archive %s" % field)
    if not isinstance(data.get("entries"), list):
        raise ArchiveError("Invalid archive entries")
    keys = set()
    for entry in data["entries"]:
        if not isinstance(entry, dict) or not isinstance(entry.get("key"), str) or not entry["key"]:
            raise ArchiveError("Invalid archive entry key")
        if entry["key"] in keys:
            raise ArchiveError("Duplicate key in owning-machine archive export")
        keys.add(entry["key"])
        if not isinstance(entry.get("gone"), bool) or (entry.get("transcript") is not None and not isinstance(entry["transcript"], str)):
            raise ArchiveError("Invalid archive transcript metadata")
        stamp = entry.get("settled_at")
        if stamp is not None and (type(stamp) not in (int, float) or not math.isfinite(stamp)):
            raise ArchiveError("Invalid archive timestamp")
        for field in ("title", "agent", "agent_name", "workspace_label", "cwd"):
            if entry.get(field) is not None and not isinstance(entry[field], str):
                raise ArchiveError("Invalid archive %s" % field)
    return data


def _validate_preview(data):
    if not isinstance(data, dict) or not isinstance(data.get("gone"), bool) or not isinstance(data.get("messages"), list):
        raise ArchiveError("Invalid transcript preview")
    for message in data["messages"]:
        if not isinstance(message, list) or len(message) != 2 or not all(isinstance(part, str) for part in message):
            raise ArchiveError("Invalid transcript message")
    return {"messages": data["messages"], "gone": data["gone"]}


def _age(stamp):
    if not stamp:
        return ""
    seconds = max(0, int(time.time() - stamp))
    if seconds < 3600:
        return "%dm ago" % max(1, seconds // 60)
    if seconds < 86400:
        return "%dh ago" % (seconds // 3600)
    return "%dd ago" % (seconds // 86400)


class ConnectedArchives:
    """Stateless connected-only view. Each operation consults live connectivity.

    snapshot() tolerates individual read failures, omitting those machines' rows.
    preview()/action() raise ArchiveError (or Core/IO errors) on failure. Mutations
    are attempted once only; callers must not automatically retry uncertain errors.
    """

    def __init__(self, legacy=None, *, timeout=10, workers=4, max_bytes=4 * 1024 * 1024, hc_command="hc"):
        self.legacy = legacy if legacy is not None else _load_legacy()
        self.legacy._hc_mode = True  # Core resumes must retain Codex --no-daemon.
        self.timeout = max(1, min(600, int(math.ceil(timeout))))
        self.workers = max(1, min(16, int(workers)))
        self.max_bytes = max_bytes
        self.hc_command = hc_command

    def connected(self):
        """Quick live descriptors; safe to poll concurrently with snapshot().

        Remote namespace is unknown until export; machine.list's id, if present,
        is useful for rejecting an export from a Core rebuilt during the fetch.
        A failed listing never reuses last-known connected names.
        """
        machines = []
        try:
            core_id, namespace = _identity(timeout=1)
            machines.append({"name": None, "label": "Local", "core_id": core_id, "namespace": namespace})
        except Exception:
            pass
        try:
            listed = hc.rpc("machine.list", timeout=1).get("machines")
            if not isinstance(listed, list):
                raise ArchiveError("Invalid connected machine list")
            named = {}
            for machine in listed:
                if not isinstance(machine, dict):
                    continue
                name = machine.get("name")
                if (machine.get("state") == "connected" and not machine.get("temporary")
                        and isinstance(name, str) and name and "\0" not in name):
                    named[name] = {"name": name, "label": name, "core_id": machine.get("id"), "namespace": None}
            machines.extend(named[name] for name in sorted(named))
        except Exception:
            pass
        return machines

    def terminal_size(self, terminal):
        if not isinstance(terminal, str) or not terminal or "/" in terminal:
            return None
        facts = hc.rpc("terminal.get", {"terminal": terminal}, timeout=1)
        cols, rows = facts.get("cols"), facts.get("rows")
        if type(cols) is int and type(rows) is int and cols > 0 and rows > 0:
            return cols, rows
        return None

    def _remote(self, machine, command, *, row=None):
        if row is None:
            shell, args = _SHELL_EXPORT, [command]
        else:
            shell, args = _SHELL_OWNER, [_OWNER_COMMAND, row["core_id"], row["namespace"], command, row["origin_key"]]
        timeout = max(90, self.timeout) if command in ("reopen", "forget") else self.timeout
        argv = [self.hc_command, "exec", "--on", machine, "--timeout", str(timeout),
                "--", "sh", "-c", shell, "settled", *args]
        return _run_bounded(argv, timeout + 1, self.max_bytes)

    def _export(self, machine):
        if machine["name"] is None:
            data = export_local(self.legacy)
        else:
            data = json.loads(self._remote(machine["name"], "export-json"))
        return _validate_export(data)

    @staticmethod
    def _matches(machine, data):
        return ((not machine.get("core_id") or machine["core_id"] == data["core_id"])
                and (not machine.get("namespace") or machine["namespace"] == data["namespace"]))

    def snapshot(self):
        before = self.connected()
        fetched, jobs, results = {}, Queue(), Queue()
        for machine in before:
            jobs.put(machine)
        def fetch():
            while True:
                try:
                    machine = jobs.get_nowait()
                except Empty:
                    return
                try:
                    data = self._export(machine)
                    results.put((machine, data))
                except Exception:
                    # Failed reads never revive cached rows from an earlier call.
                    results.put((machine, None))
        # Daemon workers avoid ThreadPoolExecutor's interpreter-exit join: closing
        # a picker must not wait for a slow remote metadata request to time out.
        for _ in range(min(self.workers, len(before))):
            threading.Thread(target=fetch, daemon=True).start()
        for _ in before:
            machine, data = results.get()
            if data is not None and self._matches(machine, data):
                fetched[machine["name"]] = data
        machines = self.connected()  # authoritative post-fetch live set
        rows = []
        for machine in machines:
            data = fetched.get(machine["name"])
            if data is None or not self._matches(machine, data):
                continue
            machine.update(core_id=data["core_id"], namespace=data["namespace"])
            for entry in data["entries"]:
                origin = entry["key"]
                # JSON encoding is injective even for slash/delimiter/newline keys.
                key = json.dumps([machine["name"], data["core_id"], data["namespace"], origin], ensure_ascii=True, separators=(",", ":"))
                age = _age(entry.get("settled_at"))
                rows.append({**entry, "kind": "settled", "key": key, "origin_key": origin,
                             "machine": machine["name"], "machine_label": machine["label"],
                             "core_id": data["core_id"], "namespace": data["namespace"],
                             "title": entry.get("title") or entry.get("agent") or origin,
                             "agent_name": entry.get("agent") or entry.get("agent_name") or "",
                             "workspace_label": entry.get("workspace_label") or "",
                             "cwd": entry.get("cwd") or "", "settled_at": entry.get("settled_at") or 0,
                             "transcript": entry.get("transcript"), "gone": entry["gone"],
                             "age": age, "status": "", "fallback": False,
                             "detail": " · ".join(x for x in (entry.get("agent") or "", entry.get("workspace_label") or "", age) if x)})
        rows.sort(key=lambda row: row["settled_at"], reverse=True)
        return {"machines": machines, "rows": rows}

    def _check_row(self, row):
        if not isinstance(row, dict) or row.get("kind") != "settled" or "machine" not in row:
            raise ArchiveError("Not an owning-machine Settled row")
        for field in ("core_id", "namespace", "origin_key"):
            if not isinstance(row.get(field), str) or not row[field] or "\0" in row[field]:
                raise ArchiveError("Invalid Settled row %s" % field)
        machine = next((m for m in self.connected() if m["name"] == row["machine"]), None)
        if machine is None:
            raise ArchiveError("Owning machine is disconnected")
        if not self._matches(machine, row):
            raise ArchiveError("Stale Settled row: owning Core or namespace changed")
        if row["machine"] is None and _identity() != (row["core_id"], row["namespace"]):
            raise ArchiveError("Stale Settled row: local Core or namespace changed")

    def preview(self, row):
        self._check_row(row)
        if row["machine"] is None:
            data = preview_local(self.legacy, row["origin_key"])
        else:
            data = json.loads(self._remote(row["machine"], "preview-json", row=row))
        self._check_row(row)  # discard a late read after disconnect/rebuild
        return _validate_preview(data)

    def action(self, row, action="reopen"):
        if action not in ("reopen", "forget"):
            raise ValueError("Unknown archive action: %s" % action)
        self._check_row(row)
        if row["machine"] is None:
            return durable_action(self.legacy, action, row["origin_key"], row["core_id"], row["namespace"])
        # The owner-side guard rechecks hello/namespace immediately before the
        # original CLI action. Do not redirect/retry if this call loses its reply.
        return self._remote(row["machine"], action, row=row).strip()
