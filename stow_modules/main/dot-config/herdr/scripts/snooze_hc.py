"""Core/App transport for snooze. Never reads or prunes legacy session state."""
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import shutil
import shlex
import subprocess
import sys
import time

_adapter = None


def adapter():
    global _adapter
    if _adapter is None:
        candidates = [Path(__file__).resolve().parents[5] / "bin/hc-preset",
                      Path.home() / "src/dotfiles/bin/hc-preset"]
        found = shutil.which("hc-preset")
        if found:
            candidates.append(Path(found))
        path = next((p for p in candidates if p.is_file()), None)
        if path is None:
            raise RuntimeError("hc-preset is not installed")
        loader = importlib.machinery.SourceFileLoader("_snooze_hc_preset", str(path))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        _adapter = importlib.util.module_from_spec(spec)
        loader.exec_module(_adapter)
    return _adapter


def enabled():
    forced = os.environ.get("HC_PRESET_BACKEND", "").lower()
    if forced in ("hc", "herdr"):
        return forced == "hc"
    if os.environ.get("HERDR_SOCKET_PATH"):
        return False
    return adapter().detect_backend() == "hc"


def state_dir():
    return str(Path(adapter().herdr_app_home()) / "data/snooze")


def read_json(name, default):
    return adapter().load_json_file(Path(state_dir()) / name, default)


def result(reply):
    if not isinstance(reply, dict) or reply.get("error"):
        raise RuntimeError(str((reply or {}).get("error") or "No reply from Herdr Core/App"))
    return reply.get("result", {})


def call(method, params, timeout=5):
    a = adapter()
    if method == "plugin.list":
        return {"plugins": []}
    if method == "plugin.pane.open":
        # The installed manifest uses argv arrays; the old popup resolver only
        # understands string commands. Launch this known picker explicitly.
        if params.get("plugin_id") != "herdr-snooze" or params.get("entrypoint") != "picker":
            raise RuntimeError("Only the snooze picker is supported here")
        env = {k: v for k, v in os.environ.items()
               if k.startswith(("HERDR_ACTIVE_", "HERDR_SNOOZE_", "SNOOZE_"))}
        env.update(params.get("env") or {})
        env.update(HC_PRESET_BACKEND="hc", HERDR_APP_HOME=a.herdr_app_home())
        exports = " ".join(f"{k}={shlex.quote(str(v))}" for k, v in env.items())
        script = str(Path(__file__).with_name("herdr-snooze.py"))
        command = f"export {exports}; exec python3 {shlex.quote(script)} picker"
        proc = subprocess.run([a.hc_bin(), "run", "--bg", "--rm", "--no-notify", "--json",
                               "--", "sh", "-c", command], capture_output=True, text=True, timeout=15)
        if proc.returncode:
            raise RuntimeError(proc.stderr.strip() or "Couldn't start snooze picker")
        address = json.loads(proc.stdout)["address"]
        a.save_json_file(Path(a.herdr_app_home()) / "data/popup-request.json",
                         {"terminal": address, "width": 820, "height": 560,
                          "ts": int(time.time() * 1000)})
        reply = a.herdr_app_do("mod.open", {"name": "prefix"})
        if not isinstance(reply, dict) or reply.get("error"):
            raise RuntimeError("Couldn't show snooze picker")
        return {}
    if method in ("agent.view.set", "agent.view.clear"):
        path = Path(state_dir()) / "agent-view.json"
        view = read_json("agent-view.json", {})
        if method.endswith("set"):
            view = {"active": True, **params}
            a.save_json_file(path, view)
        elif view.get("source") == params.get("source"):
            view = {}
            a.save_json_file(path, view)
        return view
    if method in ("pane.list", "workspace.list", "snooze.snapshot"):
        # The manage picker needs both lists. Build one world instead of
        # repeating app/core round trips for each half of the same snapshot.
        world = a.HcWorld(fetch_terminals=method != "workspace.list")
        # Losing the app connection is not evidence that its panes closed.
        if not world.app_ls.get("spaces"):
            raise RuntimeError("Herdr app layout unavailable; keeping snoozes for retry")
        if method == "workspace.list":
            return {"workspaces": world.workspaces}
        model_panes = {p.get("pane") for s in world.app_ls["spaces"]
                       for t in s.get("tabs", []) for p in t.get("terminals", [])}
        panes = [p for p in world.panes if p["pane_id"] in model_panes]
        for p in panes:
            p["tokens"] = {k: v for k, v in p.get("tokens", {}).items() if v}
        # An offline machine disappears from ls; preserve its records until it
        # returns rather than treating a disconnected terminal as closed.
        machines = result(a.hc_rpc("machine.list", {}, timeout=timeout)).get("machines", [])
        offline = {m["name"] for m in machines if m.get("state") != "connected"}
        state = read_json("snoozed.json", {})
        present = {p["pane_id"] for p in panes}
        for pid, entry in state.get("panes", {}).items():
            terminal = entry.get("terminal_id", "")
            if pid not in present and terminal.split("/", 1)[0] in offline:
                panes.append({"pane_id": pid, "terminal_id": terminal,
                              "workspace_id": entry.get("workspace_id"),
                              "agent": (entry.get("agent_id") or {}).get("agent"),
                              "agent_status": entry.get("status", ""), "tokens": {}})
        if method == "snooze.snapshot":
            return {"panes": panes, "workspaces": world.workspaces}
        return {"panes": panes}
    if method == "agent.focus":
        pane = a.HcWorld().resolve_pane(params.get("target"), hydrate=False)
        if not pane:
            raise RuntimeError("Agent is no longer available")
        reply = a.herdr_app_do("agent.focus", {"terminal": pane["terminal_id"]})
        if reply.get("error"):
            raise RuntimeError(str(reply["error"]))
        return reply
    return result(a.handle_hc_rpc_compat(method, params))
