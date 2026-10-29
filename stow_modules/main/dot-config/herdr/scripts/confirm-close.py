#!/usr/bin/env python3
"""Close the focused Herdr pane, asking first when a process is running in it.

Standalone, dependency-free Python port of https://github.com/asumaran/asconfirmclose,
extended with `--forward-vim` for smart-close.sh.

Two subcommands:
  close   inspect the focused pane and close it immediately when idle, forward
          <c-space><bs> to (n)vim when --forward-vim is passed, or open the
          confirmation popup when a non-shell process is running in it
  prompt  the confirmation popup UI (y closes the pane; any other key keeps it)
"""

from __future__ import annotations

import json
import os
import socket
import sys
import time

# Only json/os/socket/sys/time load at import time; together they are the
# idle-close hot path and what the popup prompt touches. Everything heavier
# (select, shutil, signal, subprocess, termios, tty, pathlib) is imported
# lazily inside the one function that needs it, so a keypress-triggered run
# starts ~20ms sooner. dataclasses in particular dragged in inspect/re/ast
# (~14ms), so the config/verdict carriers below are plain classes instead.
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from typing import Any, Callable

VERSION = "0.3.2"
PLUGIN_ID = "confirm-close"
UPSTREAM_PLUGIN_ID = "asumaran.asconfirmclose"
PROMPT_ENTRYPOINT = "confirm"

ENV_PANE_ID = "ASCONFIRMCLOSE_PANE_ID"
ENV_PROCESS = "ASCONFIRMCLOSE_PROCESS"
ENV_CMDLINE = "ASCONFIRMCLOSE_CMDLINE"

DEFAULT_POPUP_WIDTH = "64"
DEFAULT_POPUP_HEIGHT = "9"
UNKNOWN_PROCESS = "unknown process"

SHELL_NAMES = frozenset({
    "sh", "bash", "zsh", "fish", "dash", "ksh", "mksh", "tcsh", "csh",
    "nu", "nushell", "elvish", "xonsh", "pwsh", "powershell", "ash", "login",
})
VIM_NAMES = frozenset({"nvim", "vim"})

RESET = "\x1b[0m"
ST_TITLE = "\x1b[1m"
ST_PROCESS = "\x1b[1;38;5;11m"
ST_DIM = "\x1b[38;5;8m"
ST_KEY = "\x1b[1;38;5;11m"
ST_ERROR = "\x1b[1;38;5;9m"
ST_WARN = "\x1b[1;38;5;208m"


def style(sgr: str, text: str) -> str:
    return f"{sgr}{text}{RESET}"


class PopupConfig:
    def __init__(self, width: str = DEFAULT_POPUP_WIDTH, height: str = DEFAULT_POPUP_HEIGHT) -> None:
        self.width = width
        self.height = height


class Config:
    def __init__(self, ignore: list[str] | None = None, popup: PopupConfig | None = None) -> None:
        self.ignore: list[str] = ignore if ignore is not None else []
        self.popup = popup if popup is not None else PopupConfig()

    def ignore_set(self) -> set[str]:
        return {name.strip().lower() for name in self.ignore if isinstance(name, str) and name.strip()}


class Verdict:
    def __init__(self, busy: bool = False, process: str = "", cmdline: str = "") -> None:
        self.busy = busy
        self.process = process
        self.cmdline = cmdline


class CliError(RuntimeError):
    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(f"{code}: {message}" if message else code)
        self.code = code
        self.message = message


def default_config_dir() -> str:
    env_dir = os.environ.get("HERDR_PLUGIN_CONFIG_DIR")
    if env_dir:
        return env_dir
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config")
    for candidate in (PLUGIN_ID, UPSTREAM_PLUGIN_ID):
        path = os.path.join(base, "herdr", "plugins", "config", candidate)
        if os.path.exists(os.path.join(path, "config.json")):
            return path
    return os.path.join(base, "herdr", "plugins", "config", PLUGIN_ID)


def load_config(config_dir: str | None = None) -> tuple[Config, str | None]:
    cfg = Config()
    if config_dir is None:
        config_dir = default_config_dir()
    if not config_dir:
        return cfg, None
    path = os.path.join(config_dir, "config.json")
    try:
        with open(path, "r", encoding="utf-8") as handle:
            raw = handle.read()
    except FileNotFoundError:
        return cfg, None
    except OSError as exc:
        return cfg, str(exc)

    try:
        data = json.loads(raw)
    except ValueError as exc:
        return cfg, f"config.json: {exc}"

    if not isinstance(data, dict):
        return cfg, "config.json: top-level value must be an object"

    allowed_top = {"ignore", "popup"}
    unknown_top = set(data.keys()) - allowed_top
    if unknown_top:
        return cfg, f"config.json: unknown field {sorted(unknown_top)[0]!r}"

    ignore = data.get("ignore")
    if ignore is not None:
        if not isinstance(ignore, list) or any(not isinstance(item, str) for item in ignore):
            return Config(), "config.json: ignore must be a list of strings"
        cfg.ignore = list(ignore)

    popup = data.get("popup")
    if popup is not None:
        if not isinstance(popup, dict):
            return Config(), "config.json: popup must be an object"
        unknown_popup = set(popup.keys()) - {"width", "height"}
        if unknown_popup:
            return Config(), f"config.json: unknown popup field {sorted(unknown_popup)[0]!r}"
        width = popup.get("width")
        height = popup.get("height")
        if width is not None:
            if not isinstance(width, str):
                return Config(), "config.json: popup.width must be a string"
            if width:
                cfg.popup.width = width
        if height is not None:
            if not isinstance(height, str):
                return Config(), "config.json: popup.height must be a string"
            if height:
                cfg.popup.height = height

    return cfg, None


def herdr_bin() -> str:
    env_bin = os.environ.get("HERDR_BIN_PATH")
    if env_bin and os.path.isfile(env_bin) and os.access(env_bin, os.X_OK):
        return env_bin
    import shutil

    resolved = shutil.which("herdr")
    if resolved:
        return resolved
    for candidate in (
        os.path.expanduser("~/.local/bin/herdr"),
        "/opt/homebrew/bin/herdr",
        "/usr/local/bin/herdr",
    ):
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return "herdr"


def herdr_socket() -> str | None:
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


def parse_popup_size(value: str) -> int | str:
    text = value.strip()
    if text.isdigit():
        return int(text)
    return text


class HerdrRunner:
    def __init__(self, bin_path: str | None = None, socket_path: str | None = None) -> None:
        # Resolve the binary lazily (see cli()): the socket branch is the only
        # one the hot path takes, so skip the herdr_bin() PATH scan here.
        self.bin_path = bin_path
        self.socket_path = socket_path if socket_path is not None else herdr_socket()

    def request(self, method: str, params: dict[str, Any], timeout: float = 2.0) -> dict[str, Any]:
        if not self.socket_path:
            raise OSError("herdr socket not found")
        payload = {
            "id": f"confirm-close:{time.time_ns()}:{os.getpid()}",
            "method": method,
            "params": params,
        }
        client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        client.settimeout(timeout)
        try:
            client.connect(self.socket_path)
            client.sendall((json.dumps(payload) + "\n").encode("utf-8"))
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
            raise RuntimeError("herdr closed connection without response")
        line = b"".join(chunks).split(b"\n", 1)[0]
        env = json.loads(line.decode("utf-8", "replace"))
        if not isinstance(env, dict):
            raise RuntimeError("unexpected herdr response")
        err = env.get("error")
        if isinstance(err, dict):
            raise CliError(str(err.get("code") or "error"), str(err.get("message") or ""))
        result = env.get("result")
        if not isinstance(result, dict):
            raise RuntimeError("herdr response has no result")
        return result

    def cli(self, *args: str) -> dict[str, Any]:
        import subprocess

        proc = subprocess.run(
            [self.bin_path or herdr_bin(), *args],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
        out = (proc.stdout or "").strip()
        if out:
            try:
                env = json.loads(out.splitlines()[-1])
                if isinstance(env, dict):
                    err = env.get("error")
                    if isinstance(err, dict):
                        raise CliError(str(err.get("code") or "error"), str(err.get("message") or ""))
                    result = env.get("result")
                    if isinstance(result, dict):
                        return result
            except ValueError:
                pass
        if proc.returncode != 0:
            msg = (proc.stderr or "").strip() or out or f"exit status {proc.returncode}"
            raise RuntimeError(f"herdr {' '.join(args)}: {msg}")
        raise RuntimeError("herdr response has no result")

    def call(self, method: str, params: dict[str, Any], cli_args: list[str]) -> dict[str, Any]:
        if self.socket_path:
            try:
                return self.request(method, params)
            except CliError:
                raise
            except Exception:
                pass
        return self.cli(*cli_args)


def process_display_name(entry: dict[str, Any]) -> str:
    name = entry.get("argv0") or ""
    if not name:
        argv = entry.get("argv")
        if isinstance(argv, list) and argv and isinstance(argv[0], str):
            name = argv[0]
    if not name:
        name = entry.get("name") or ""
    if not isinstance(name, str):
        name = ""
    space = name.find(" ")
    if space > 0:
        name = name[:space]
    name = os.path.basename(name).lstrip("-")
    if name in ("", ".", "/"):
        raw_name = entry.get("name")
        name = raw_name.lstrip("-") if isinstance(raw_name, str) else ""
    return name


def is_shell(name: str, ignore: set[str]) -> bool:
    lower = name.lower()
    return lower in SHELL_NAMES or lower in ignore


def is_vim_process(info: dict[str, Any]) -> bool:
    procs = info.get("foreground_processes")
    if not isinstance(procs, list):
        return False
    for proc in procs:
        if not isinstance(proc, dict):
            continue
        if process_display_name(proc).lower() in VIM_NAMES:
            return True
        raw_name = proc.get("name")
        if isinstance(raw_name, str) and os.path.basename(raw_name).lstrip("-").lower() in VIM_NAMES:
            return True
    return False


def classify(info: dict[str, Any], ignore: set[str] | None = None) -> Verdict:
    ignore_set = ignore or set()
    fg_group = info.get("foreground_process_group_id")
    shell_pid = info.get("shell_pid")
    procs = info.get("foreground_processes")
    if not isinstance(procs, list):
        procs = []

    leader: dict[str, Any] | None = None
    first: dict[str, Any] | None = None
    for proc in procs:
        if not isinstance(proc, dict):
            continue
        if is_shell(process_display_name(proc), ignore_set):
            continue
        if first is None:
            first = proc
        if fg_group is not None and proc.get("pid") == fg_group:
            leader = proc
            break

    pick = leader if leader is not None else first
    if pick is not None:
        cmdline = pick.get("cmdline")
        return Verdict(
            busy=True,
            process=process_display_name(pick),
            cmdline=cmdline.strip() if isinstance(cmdline, str) else "",
        )

    if not procs and fg_group is not None and shell_pid is not None and fg_group != shell_pid:
        return Verdict(busy=True, process=UNKNOWN_PROCESS, cmdline="")

    return Verdict()


def current_pane_id(runner: HerdrRunner) -> str:
    for env_name in ("HERDR_ACTIVE_PANE_ID", "HERDR_PANE_ID"):
        val = os.environ.get(env_name)
        if val:
            return val
    try:
        res = runner.call("pane.layout", {}, ["pane", "layout", "--current"])
        layout = res.get("layout")
        if isinstance(layout, dict):
            focused = layout.get("focused_pane_id")
            if isinstance(focused, str) and focused:
                return focused
    except Exception:
        pass
    res = runner.call("pane.current", {}, ["pane", "current"])
    pane = res.get("pane")
    if isinstance(pane, dict):
        pane_id = pane.get("pane_id")
        if isinstance(pane_id, str) and pane_id:
            return pane_id
    raise RuntimeError("herdr pane current returned no pane_id")


def fetch_process_info(runner: HerdrRunner, pane_id: str) -> dict[str, Any]:
    res = runner.call(
        "pane.process_info",
        {"pane_id": pane_id},
        ["pane", "process-info", "--pane", pane_id],
    )
    info = res.get("process_info")
    if not isinstance(info, dict):
        raise RuntimeError("herdr response has no process_info")
    return info


def close_pane(runner: HerdrRunner, pane_id: str) -> None:
    runner.call("pane.close", {"pane_id": pane_id}, ["pane", "close", pane_id])


def send_keys(runner: HerdrRunner, pane_id: str, keys: list[str]) -> None:
    runner.call(
        "pane.send_keys",
        {"pane_id": pane_id, "keys": keys},
        ["pane", "send-keys", pane_id, *keys],
    )


def ensure_local_plugin_linked(runner: HerdrRunner) -> None:
    from pathlib import Path

    plugin_dir = Path(__file__).resolve().parents[1] / "local-plugins" / PLUGIN_ID
    if not (plugin_dir / "herdr-plugin.toml").is_file():
        return
    try:
        runner.call(
            "plugin.link",
            {"path": str(plugin_dir), "enabled": True},
            ["plugin", "link", str(plugin_dir), "--enabled"],
        )
    except Exception:
        pass


def open_confirm_popup(
    runner: HerdrRunner,
    cfg: Config,
    pane_id: str,
    verdict: Verdict,
) -> None:
    env: dict[str, str] = {
        ENV_PANE_ID: pane_id,
        ENV_PROCESS: verdict.process,
    }
    if verdict.cmdline:
        env[ENV_CMDLINE] = verdict.cmdline

    cli_args = [
        "plugin", "pane", "open",
        "--plugin", PLUGIN_ID,
        "--entrypoint", PROMPT_ENTRYPOINT,
        "--placement", "popup",
        "--focus",
        "--width", cfg.popup.width,
        "--height", cfg.popup.height,
        "--env", f"{ENV_PANE_ID}={pane_id}",
        "--env", f"{ENV_PROCESS}={verdict.process}",
    ]
    if verdict.cmdline:
        cli_args.extend(["--env", f"{ENV_CMDLINE}={verdict.cmdline}"])

    params: dict[str, Any] = {
        "plugin_id": PLUGIN_ID,
        "entrypoint": PROMPT_ENTRYPOINT,
        "placement": "popup",
        "focus": True,
        "width": parse_popup_size(cfg.popup.width),
        "height": parse_popup_size(cfg.popup.height),
        "env": env,
    }
    try:
        runner.call("plugin.pane.open", params, cli_args)
    except Exception:
        ensure_local_plugin_linked(runner)
        runner.call("plugin.pane.open", params, cli_args)


def run_close(
    runner: HerdrRunner,
    cfg: Config,
    pane_id: str = "",
    forward_vim: bool = False,
    log: Any = sys.stderr,
) -> str:
    if not pane_id:
        pane_id = current_pane_id(runner)

    try:
        info = fetch_process_info(runner, pane_id)
    except CliError as exc:
        if exc.code == "pane_not_found":
            raise
        print(f"process-info failed ({exc}); asking before closing", file=log)
        verdict = Verdict(busy=True, process=UNKNOWN_PROCESS)
    except Exception as exc:
        print(f"process-info failed ({exc}); asking before closing", file=log)
        verdict = Verdict(busy=True, process=UNKNOWN_PROCESS)
    else:
        if forward_vim and is_vim_process(info):
            send_keys(runner, pane_id, ["ctrl+space", "backspace"])
            return "forwarded"
        verdict = classify(info, cfg.ignore_set())

    if not verdict.busy:
        close_pane(runner, pane_id)
        print(f"closed idle pane {pane_id}", file=log)
        return "closed"

    open_confirm_popup(runner, cfg, pane_id, verdict)
    print(f"pane {pane_id} is running {verdict.process}; opened confirmation", file=log)
    return "prompted"


def truncate(text: str, max_cells: int) -> str:
    if max_cells <= 1:
        return text
    if len(text) <= max_cells:
        return text
    return text[: max_cells - 1] + "…"


def render_prompt(
    pane_id: str,
    process: str,
    cmdline: str,
    width: int = 64,
    closing: bool = False,
    err: str | None = None,
) -> str:
    inner = width - 4
    if inner < 20:
        inner = 60
    lines = ["", "  " + style(ST_TITLE, "Close pane?"), ""]
    if err is not None:
        lines.append("  " + style(ST_ERROR, "Could not close the pane"))
        lines.append("  " + style(ST_DIM, truncate(err, inner - 2)))
        lines.append("")
        lines.append("  " + style(ST_DIM, "press any key to dismiss"))
    elif closing:
        lines.append("  " + style(ST_DIM, "closing…"))
    else:
        if process == UNKNOWN_PROCESS:
            lines.append(
                f"  Pane {style(ST_TITLE, pane_id)} is running {style(ST_WARN, 'an unknown process')}"
            )
            lines.append(
                "  " + style(ST_DIM, "herdr could not inspect the pane; it may still be busy")
            )
        else:
            lines.append(
                f"  Pane {style(ST_TITLE, pane_id)} is running {style(ST_PROCESS, process)}"
            )
            if cmdline and cmdline != process:
                lines.append("  " + style(ST_DIM, truncate(cmdline, inner - 2)))
        lines.append("")
        lines.append(
            "  "
            + style(ST_KEY, "y")
            + style(ST_DIM, " / ")
            + style(ST_KEY, "enter")
            + " close    "
            + style(ST_KEY, "n")
            + style(ST_DIM, " / ")
            + style(ST_KEY, "esc")
            + " keep"
        )
    return "\n".join(lines) + "\n"


def read_single_key(fd: int) -> str:
    import select

    while True:
        ready, _, _ = select.select([fd], [], [], 0.1)
        if not ready:
            continue
        data = os.read(fd, 64)
        if not data:
            return "esc"
        if data[:1] == b"\x1b":
            # Drain any remaining bytes of an escape sequence.
            while select.select([fd], [], [], 0.01)[0]:
                if not os.read(fd, 64):
                    break
            return "esc"
        try:
            ch = data.decode("utf-8", "replace")[0]
        except IndexError:
            return "esc"
        return ch


def run_prompt(
    pane_id: str,
    process: str,
    cmdline: str,
    close_fn: Callable[[], None],
) -> int:
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        print("error: prompt requires a terminal", file=sys.stderr)
        return 1

    import select
    import shutil
    import signal
    import termios
    import tty

    fd = sys.stdin.fileno()
    old_attrs = termios.tcgetattr(fd)
    resized = False

    def on_winch(*_args: Any) -> None:
        nonlocal resized
        resized = True

    prev_winch = signal.signal(signal.SIGWINCH, on_winch)

    def draw(closing: bool = False, err: str | None = None) -> None:
        cols = shutil.get_terminal_size((64, 9)).columns
        frame = render_prompt(pane_id, process, cmdline, width=cols, closing=closing, err=err)
        sys.stdout.write("\x1b[2J\x1b[H" + frame.replace("\n", "\r\n"))
        sys.stdout.flush()

    try:
        tty.setraw(fd)
        sys.stdout.write("\x1b[?25l")
        draw()
        while True:
            if resized:
                resized = False
                draw()
            ready, _, _ = select.select([fd], [], [], 0.05)
            if not ready:
                continue
            key = read_single_key(fd)
            if key in ("y", "Y", "\r", "\n"):
                draw(closing=True)
                try:
                    close_fn()
                    return 0
                except Exception as exc:
                    draw(closing=False, err=str(exc))
                    read_single_key(fd)
                    return 1
            return 0
    finally:
        try:
            sys.stdout.write("\x1b[?25h")
            sys.stdout.flush()
        except Exception:
            pass
        try:
            termios.tcsetattr(fd, termios.TCSADRAIN, old_attrs)
        except Exception:
            pass
        try:
            signal.signal(signal.SIGWINCH, prev_winch)
        except Exception:
            pass


def usage() -> None:
    print(
        f"""usage: confirm-close.py <close|prompt> [flags]

  close [--pane ID] [--forward-vim]
          inspect the focused pane and close it, or open the confirmation
          popup when a process is running in it
  prompt  the confirmation popup (reads {ENV_PANE_ID}, {ENV_PROCESS}, {ENV_CMDLINE})

flags:
  -version, --version   print the version and exit""",
        file=sys.stderr,
    )


def main(argv: list[str] | None = None) -> int:
    args = list(argv if argv is not None else sys.argv[1:])
    if args in (["-version"], ["--version"]):
        print(f"asconfirmclose {VERSION}")
        return 0
    if not args or args[0] in ("-h", "--help"):
        usage()
        return 0 if args else 2

    cmd = args[0]
    rest = args[1:]

    cfg, cfg_err = load_config()
    if cfg_err:
        print(f"config: {cfg_err} (using defaults)", file=sys.stderr)

    runner = HerdrRunner()

    if cmd == "close":
        pane_id = ""
        forward_vim = False
        i = 0
        while i < len(rest):
            arg = rest[i]
            if arg == "--forward-vim":
                forward_vim = True
                i += 1
            elif arg == "--pane" and i + 1 < len(rest):
                pane_id = rest[i + 1]
                i += 2
            elif arg.startswith("--pane="):
                pane_id = arg.split("=", 1)[1]
                i += 1
            else:
                usage()
                return 2
        if not pane_id:
            pane_id = os.environ.get("HERDR_ACTIVE_PANE_ID") or os.environ.get("HERDR_PANE_ID") or ""
        try:
            run_close(runner, cfg, pane_id=pane_id, forward_vim=forward_vim, log=sys.stderr)
            return 0
        except Exception as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 1

    if cmd == "prompt":
        if rest:
            usage()
            return 2
        pane_id = os.environ.get(ENV_PANE_ID, "")
        if not pane_id:
            print(f"error: {ENV_PANE_ID} is not set; run through the close action", file=sys.stderr)
            return 2
        process = os.environ.get(ENV_PROCESS) or UNKNOWN_PROCESS
        cmdline = os.environ.get(ENV_CMDLINE, "")
        return run_prompt(pane_id, process, cmdline, lambda: close_pane(runner, pane_id))

    usage()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
