#!/usr/bin/env python3
"""Connected-machine completion and host-local ask-agent dispatch over hc.

The target runs the current ask script with its own HOME, PATH and helpers.
No local working directory, temporary prompt path or agent session is reused.
"""
import json
from pathlib import Path
import shutil
import subprocess
import sys

RESULT_PREFIX = "ASK_AGENT_REMOTE_RESULT="
# Match ask-agent's tool PATH before requiring Python on the target core.
REMOTE_PYTHON = ('export PATH="$HOME/.local/bin:$HOME/src/dotfiles/bin:/opt/homebrew/bin:'
                 '/opt/chef/embedded/bin:/usr/local/bin:$PATH"; exec python3 -c "$1"')
REMOTE_RUNNER = r'''
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

request = json.load(sys.stdin)
scripts = Path.home() / ".config/herdr/scripts"
for name in ("herdr-lib.sh", "prompt-lib.sh"):
    if not (scripts / name).is_file():
        raise SystemExit(f"ask: target needs {scripts / name}")
# Execute the supplied version of ask-agent, but source the target's installed
# helpers. This does not overwrite its config or require a prior dotfile sync.
with tempfile.TemporaryDirectory(prefix="ask-machine-") as temp:
    prompt = Path(temp) / "question.prompt"
    prompt.write_text(request["question"], encoding="utf-8")
    result_file = Path(temp) / "result.json"
    env = dict(os.environ)
    for key in list(env):
        if key.startswith("HERDR_") or key in ("ASK_AGENT_MACHINE", "ASK_AGENT_CWD", "ASK_AGENT_CONTEXT", "ASK_AGENT_SRC",
                                                          "ASK_AGENT_PROJECT_CHOICES", "ASK_AGENT_TRY_CHOICES", "ASK_AGENT_COMPLETION_WARNING"):
            env.pop(key, None)
    # Linux cores put their socket in XDG_RUNTIME_DIR, while older adapters
    # only search ~/.local/state. Supply the target's socket explicitly.
    if not env.get("HC_SOCKET") and env.get("XDG_RUNTIME_DIR"):
        socket = Path(env["XDG_RUNTIME_DIR"]) / "herdr-core" / ((env.get("HC_SESSION") or "default") + ".sock")
        if socket.exists():
            env["HC_SOCKET"] = str(socket)
    env.update(HC_PRESET_BACKEND="hc", HERDR_DIE_HOLD_CHARS="999999",
               PROMPT_HOLD_ON_ERROR="0", ASK_AGENT_RESULT_FILE=str(result_file))
    mode = "--dispatch-foreground" if request["focus"] else "--dispatch"
    rc = subprocess.call(["/bin/bash", "-c", request["script"],
                          str(scripts / "ask-agent.sh"), mode, str(prompt)], env=env)
    if rc:
        raise SystemExit(rc)
    result = json.loads(result_file.read_text())
    print("ASK_AGENT_REMOTE_RESULT=" + json.dumps(result))
'''


def connected_machines(hc: str) -> list[str]:
    result = subprocess.run([hc, "machine", "ls"], capture_output=True, text=True, timeout=10)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "could not list connected machines")
    data = json.loads(result.stdout)
    return sorted({m["name"] for m in data.get("machines", [])
                   if m.get("state") == "connected" and not m.get("temporary")
                   and isinstance(m.get("name"), str) and m["name"]
                   and not any(c.isspace() for c in m["name"])})


def dispatch(hc: str, machine: str, focus: bool, script: Path, adapter: str, question: str) -> int:
    if machine not in connected_machines(hc):
        raise ValueError(f"machine:{machine} is not a connected machine")
    request = {"script": script.read_text(), "question": question, "focus": focus}
    # exec waits only for routing/launch/readiness, not for the agent's answer.
    # Agent terminals are independent of this ephemeral dispatch process.
    result = subprocess.run(
        [hc, "exec", "--on", machine, "--timeout", "120", "-i", "/bin/sh", "-c",
         REMOTE_PYTHON, "ask-python", REMOTE_RUNNER],
        input=json.dumps(request), capture_output=True, text=True, timeout=130,
    )
    if result.returncode:
        sys.stdout.write(result.stdout)
        sys.stderr.write(result.stderr)
        return result.returncode
    output, marker, raw_result = result.stdout.rpartition(RESULT_PREFIX)
    sys.stdout.write(output if marker else result.stdout)
    if not marker:
        raise RuntimeError("remote dispatch returned no launch result; do not retry blindly")
    created = json.loads(raw_result)
    terminal = created["result"]["root_pane"]["terminal_id"]
    if focus:
        focused = subprocess.run([adapter, "--backend", "hc", "do", "agent.focus", "--terminal", f"{machine}/{terminal}"],
                                 capture_output=True, text=True, timeout=10)
        if focused.returncode:
            raise RuntimeError(f"agent started on {machine}/{terminal}, but focus failed: {focused.stderr.strip()}")
    print(f"agent created on {machine}/{terminal}")
    return 0


def main(argv: list[str]) -> int:
    hc = shutil.which("hc")
    if argv == ["machines"]:
        # Completion must not prevent ordinary local asks when a core is absent.
        try:
            names = connected_machines(hc) if hc else []
        except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired):
            names = []
        print(json.dumps(["local", *(name for name in names if name != "local")]))
        return 0
    if len(argv) != 5 or argv[0] != "dispatch":
        raise ValueError("usage: ask-machine.py machines | dispatch MACHINE FOCUS SCRIPT ADAPTER")
    if not hc:
        raise RuntimeError("hc CLI not found")
    _, machine, focus, script, adapter = argv
    if focus not in ("--focus", "--no-focus"):
        raise ValueError("invalid dispatch focus mode")
    return dispatch(hc, machine, focus == "--focus", Path(script), adapter, sys.stdin.read())


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.TimeoutExpired) as exc:
        print(f"ask: {exc}", file=sys.stderr)
        sys.exit(1)
