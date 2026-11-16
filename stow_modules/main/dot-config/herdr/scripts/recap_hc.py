"""Herdr Core/App backend for herdr-recap; legacy socket code stays in place."""
from __future__ import annotations

import base64
import hashlib
import importlib.machinery
import importlib.util
import inspect
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
from typing import Any

_adapter = None


def adapter():
    global _adapter
    if _adapter is None:
        candidates = [Path(__file__).resolve().parents[5] / "bin" / "hc-preset",
                      Path.home() / "src/dotfiles/bin/hc-preset",
                      Path.home() / ".local/bin/hc-preset"]
        found = shutil.which("hc-preset")
        if found:
            candidates.append(Path(found))
        path = next((p for p in candidates if p.is_file()), None)
        if path is None:
            raise RuntimeError("hc-preset is not installed")
        loader = importlib.machinery.SourceFileLoader("_recap_hc_preset", str(path))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        module = importlib.util.module_from_spec(spec)
        loader.exec_module(module)
        _adapter = module
    return _adapter


def enabled() -> bool:
    # Preserve explicit legacy callers even if a Herdr.app window is open too.
    forced = os.environ.get("HC_PRESET_BACKEND", "").lower()
    if forced in ("herdr", "hc"):
        return forced == "hc"
    if os.environ.get("HERDR_SOCKET_PATH"):
        return False
    try:
        return adapter().detect_backend() == "hc"
    except RuntimeError:
        return False


def result(reply: dict[str, Any] | None) -> Any:
    if not isinstance(reply, dict):
        raise RuntimeError("No reply from Herdr Core/App; inspect state before retrying")
    error = reply.get("error")
    if error:
        raise RuntimeError(str(error))
    return reply.get("result", {})


def core(method: str, params: dict[str, Any], timeout: float = 5) -> Any:
    return result(adapter().hc_rpc(method, params, timeout=timeout))


def call(method: str, params: dict[str, Any], timeout: float = 5) -> Any:
    a = adapter()
    if method in ("agent.focus", "agent.prompt", "pane.close", "terminal.pin", "pane.report_metadata"):
        world = a.HcWorld()
        target = params.get("target") or params.get("pane_id")
        pane = world.resolve_pane(target, hydrate=method == "terminal.pin")
        if pane is None:
            raise RuntimeError(f"Agent {target} is no longer available")
        terminal = pane["terminal_id"]
        if method == "agent.focus":
            return a.herdr_app_do("agent.focus", {"terminal": terminal})
        if method == "pane.close":
            if pane["pane_id"] != terminal:
                return a.herdr_app_do("pane.close", {"pane": pane["pane_id"]})
            return core("terminal.kill", {"terminal": terminal})
        if method == "terminal.pin":
            pinned = bool((pane.get("labels") or {}).get("herdr.pinned"))
            return a.herdr_app_do("terminal.pin", {"terminal": terminal, "pinned": not pinned})
        if method == "pane.report_metadata" and params.get("title"):
            return a.herdr_app_do("tab.rename", {"id": pane["tab_id"], "name": params["title"]})
        if method == "agent.prompt":
            sent = core("terminal.send", {"terminal": terminal, "text": params["text"]},
                        timeout=max(timeout, 75))
            if sent.get("started") is False:
                # Never retry text or Enter on an uncertain submission.
                raise RuntimeError("Message delivered but agent did not start; inspect its terminal before retrying")
            return sent
    if method == "plugin.pane.open":
        if params["plugin_id"] != "herdr-recap" or params["entrypoint"] != "picker":
            raise RuntimeError("Legacy plugin handoffs are not available in Herdr.app")
        env = {"HC_PRESET_BACKEND": "hc", "HERDR_APP_HOME": a.herdr_app_home(),
               **(params.get("env") or {})}
        launched = core("terminal.run", {
            "argv": [sys.executable, str(Path(__file__).with_name("herdr-recap.py")), "picker"],
            "env": env, "cwd": str(Path.home()), "rm": True, "no_notify": True,
            "caller": os.environ.get("HC_TERMINAL_ID"),
        })
        terminal = launched["address"]
        try:
            a.save_json_file(Path(a.herdr_app_home()) / "data/popup-request.json", {
                "terminal": terminal, "width": 920, "height": 620,
                "ts": int(time.time() * 1000),
            })
            a.herdr_app_do("mod.open", {"name": "prefix"})
        except Exception:
            core("terminal.kill", {"terminal": terminal})
            raise
        return {"pane": {"pane_id": terminal, "terminal_id": terminal}}
    if method == "plugin.list":
        # Legacy plugin registry isn't the app's mod registry.
        return {"plugins": []}
    return result(a.handle_hc_rpc_compat(method, params))


def exec_on(machine: str, argv: list[str], cwd: str = "") -> str:
    params: dict[str, Any] = {"on": machine, "argv": argv, "timeout": 15}
    if cwd:
        params["cwd"] = cwd
    response = core("machine.exec", params, timeout=20)
    if response.get("code") != 0 or response.get("timed_out") or response.get("truncated"):
        error = base64.b64decode(response.get("stderr") or "").decode("utf-8", "replace")
        raise RuntimeError(error.strip() or f"Couldn't read recap data on {machine}")
    return base64.b64decode(response.get("stdout") or "").decode("utf-8", "replace")


def probe_pi(ref: dict, cwd: str, argv: list, pid: int, title: str) -> dict:
    """Read only an exact session ref, fd, UUID, or unique persisted title.

    Runs on the terminal's machine. Never choose the latest file in a cwd:
    parallel sessions often share the same directory.
    """
    root = Path(os.environ.get("PI_CODING_AGENT_DIR") or Path.home() / ".pi/agent") / "sessions"
    kind, value = ref.get("kind"), ref.get("value", "")
    path, sid = "", ""
    if kind == "path" and value:
        path = str(value)
    elif kind == "id" and value:
        sid = str(value)
    if not path and not sid:
        for i, arg in enumerate(argv):
            if arg in ("--session", "--session-id") and i + 1 < len(argv):
                value = str(argv[i + 1])
                if arg == "--session" and value.endswith(".jsonl"):
                    path = str(Path(value) if Path(value).is_absolute() else Path(cwd) / value)
                else:
                    sid = value
                break
            if str(arg).startswith("--session-id="):
                sid = str(arg).split("=", 1)[1]
                break
    if not path and not sid and pid:
        # Linux open fds; macOS lsof. Pi may close its transcript between writes.
        files = []
        if sys.platform.startswith("linux"):
            try:
                files = [os.readlink(fd) for fd in Path(f"/proc/{pid}/fd").iterdir()]
            except OSError:
                pass
        else:
            try:
                output = subprocess.run(["lsof", "-a", "-p", str(pid), "-Fn"],
                                        capture_output=True, text=True, timeout=3).stdout
                files = [line[1:] for line in output.splitlines() if line.startswith("n/")]
            except (OSError, subprocess.TimeoutExpired):
                pass
        matches = [f for f in files if f.endswith(".jsonl") and str(root) + os.sep in f]
        if len(set(matches)) == 1:
            path = matches[0]
    if not path and sid and re.fullmatch(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}", sid):
        matches = list(root.glob(f"*/*_{sid}.jsonl"))
        if len(matches) == 1:
            path = str(matches[0])
    if not path and not sid and title and cwd:
        directory = root / ("--" + cwd.replace("/", "-").replace("\\", "-").strip("-") + "--")
        matches = []
        for candidate in directory.glob("*.jsonl"):
            try:
                with candidate.open("rb") as handle:
                    handle.seek(max(0, candidate.stat().st_size - 512 * 1024))
                    lines = handle.read().decode("utf-8", "replace").splitlines()
                name = ""
                for line in lines:
                    try:
                        entry = json.loads(line)
                    except ValueError:
                        continue
                    if entry.get("type") == "session_info":
                        name = entry.get("name", "")
                if name == title:
                    matches.append(candidate)
            except OSError:
                continue
        if len(matches) == 1:
            path = str(matches[0])
    if not path or not Path(path).is_file():
        raise RuntimeError("Session path unavailable; run /reload in this Pi agent to enable recaps")
    stat = Path(path).stat()
    with open(path, "rb") as handle:
        head = handle.read(64 * 1024)
        if stat.st_size > 512 * 1024:
            handle.seek(stat.st_size - 512 * 1024)
            handle.readline()  # drop the partial first row
            data = head + b"\n" + handle.read()
        else:
            handle.seek(0)
            data = handle.read()
    return {"path": str(path), "text": data.decode("utf-8", "replace"), "mtime_ns": stat.st_mtime_ns}


def pi_session(agent, cache_dir: Path) -> tuple[str, str]:
    pane = adapter().HcWorld().resolve_pane(agent.terminal_id or agent.pane_id)
    if pane is None:
        raise RuntimeError("Agent is no longer available")
    foreground = pane.get("foreground") or {}
    args = [agent.agent_session, pane.get("foreground_cwd") or agent.cwd,
            foreground.get("argv") or [], int(foreground.get("pid") or 0), pane.get("title") or agent.title]
    if not agent.machine:
        snapshot = probe_pi(*args)
        return snapshot["path"], snapshot["path"]
    source = "import json, os, re, subprocess, sys\nfrom pathlib import Path\n" + inspect.getsource(probe_pi)
    source += "\nprint(json.dumps(probe_pi(*json.loads(sys.argv[1]))))\n"
    snapshot = json.loads(exec_on(agent.machine, ["python3", "-c", source, json.dumps(args)]))
    identity = agent.machine + ":" + snapshot["path"]
    cache_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = cache_dir / (hashlib.sha256(identity.encode()).hexdigest() + ".jsonl")
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=cache_dir, delete=False) as handle:
        tmp = Path(handle.name)
        handle.write(snapshot["text"])
    try:
        os.utime(tmp, ns=(snapshot["mtime_ns"], snapshot["mtime_ns"]))
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)
    return identity, str(path)
