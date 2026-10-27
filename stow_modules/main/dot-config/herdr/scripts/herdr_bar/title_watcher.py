"""One reconnecting background watcher per Herdr server, for tab titles and status."""

from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path
from typing import IO, Callable, Optional, Union

from . import host
from .auto_title import AutoTitles, title_state_dir
from .client import EventStream, HerdrClient, HerdrError
from .config import Config
from .opener import default_socket_path
from .renaming_guard import (
    AutomaticTabClient,
    RenamingPluginDetected,
    check_plugins,
    installed_plugins,
)
from .tab_status import TabStatus

INTERVAL = 2
REGISTRATION_INTERVAL = 10
MAX_BACKOFF = 30
LOCK_BY_NAME = "-"


def _script_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _entry_script(root: Optional[Path] = None) -> Path:
    base = root if root is not None else _script_root()
    candidate = base / "herdr-bar.py"
    if candidate.is_file():
        return candidate
    return base / "run.py"


def start(resume: bool = False) -> None:
    """Best-effort launch; unavailable state storage must never break the popup."""
    titles = AutoTitles()
    directory = titles.state_dir
    socket_path = default_socket_path()
    if directory is None or not socket_path:
        return
    if not titles.enabled and not Config.load().tab_status:
        records = TabStatus(HerdrClient(socket_path=socket_path, socket_only=True), directory).records
        if not any(not record.get("yielded") for record in records.values()):
            return
    try:
        directory.mkdir(parents=True, exist_ok=True)
        with (directory / "title-launch.lock").open("a") as gate:
            try:
                host.lock(gate, blocking=resume)
            except BlockingIOError:
                return
            _launch(directory, resume)
    except OSError as error:
        print("herdr-bar: title watcher could not start: %s" % error, file=sys.stderr)


def _launch(directory: Path, resume: bool) -> None:
    stopped = directory / "title-watcher.stopped"
    if resume:
        stopped.unlink(missing_ok=True)
    elif stopped.exists():
        return
    with (directory / "title-watcher.lock").open("a") as lock:
        try:
            host.lock(lock)
        except BlockingIOError:
            return
        with _log(directory) as log:
            _spawn(_entry_script(), directory, log, lock)


def _log(directory: Path) -> IO:
    return (directory / "title-watcher.log").open("a", encoding="utf-8", errors="replace")


def _spawn(entry_py: Path, directory: Path, log: IO, lock: Optional[IO]) -> None:
    if host.WINDOWS:
        if lock is not None:
            host.unlock(lock)
        token = LOCK_BY_NAME
    else:
        token = str(lock.fileno())
    env = dict(os.environ)
    sock = default_socket_path()
    if sock and not env.get("HERDR_SOCKET_PATH"):
        env["HERDR_SOCKET_PATH"] = sock
    subprocess.Popen(
        [sys.executable, str(entry_py), "--watch-titles", token],
        cwd=str(directory),
        stdin=subprocess.DEVNULL,
        stdout=log,
        stderr=log,
        env=env,
        **host.detached_process_options(lock),
    )


def stop() -> None:
    directory = title_state_dir()
    if directory is not None:
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "title-watcher.stopped").touch()


def finish_if_stopped(lock, directory: Path,
                      cleanup: Optional[Callable[[], None]] = None) -> bool:
    stopped = directory / "title-watcher.stopped"
    if not stopped.exists():
        return False
    try:
        with (directory / "title-launch.lock").open("a") as gate:
            host.lock(gate, blocking=True)
            if stopped.exists():
                if cleanup is not None:
                    cleanup()
                lock.close()
                return True
    except OSError:
        pass
    return False


def registered_root(client: HerdrClient) -> Optional[Path]:
    """Check competing plugins and return the active script root."""
    plugins = installed_plugins(client)
    check_plugins(plugins, Config.load().tab_renaming_plugins)
    for plugin in plugins:
        if isinstance(plugin, dict) and plugin.get("plugin_id") == "herdr-bar":
            if not plugin.get("enabled"):
                return None
            return _script_root()
    # When running as a standalone script without plugin registration, stay up.
    return _script_root()


def revision(root: Path) -> tuple:
    """Detect in-place code edits so the watcher reloads automatically."""
    entry = _entry_script(root)
    files = ([entry] if entry.is_file() else []) + sorted((root / "herdr_bar").glob("*.py"))
    out = []
    for path in files:
        try:
            st = path.stat()
            out.append((str(path), st.st_mtime_ns, st.st_size))
        except OSError:
            continue
    return tuple(out)


def replace(root: Path, lock: Union[int, IO]) -> None:
    entry = _entry_script(root)
    if host.WINDOWS and not isinstance(lock, int):
        directory = Path(lock.name).parent
        lock.close()
        with _log(directory) as log:
            _spawn(entry, directory, log, None)
        return
    lock_fd = lock if isinstance(lock, int) else lock.fileno()
    os.set_inheritable(lock_fd, True)
    os.execv(sys.executable, [sys.executable, str(entry), "--watch-titles", str(lock_fd)])


def claim(directory: Path) -> Optional[IO]:
    directory.mkdir(parents=True, exist_ok=True)
    lock = (directory / "title-watcher.lock").open("a")
    try:
        host.lock(lock)
    except BlockingIOError:
        lock.close()
        return None
    return lock


def watch(lock_fd: Optional[int]) -> int:
    client = HerdrClient(timeout=2, socket_only=True)
    titles = AutoTitles()
    if titles.state_dir is None:
        if lock_fd is not None:
            os.close(lock_fd)
        return 0
    lock = os.fdopen(lock_fd, "a") if lock_fd is not None else claim(titles.state_dir)
    if lock is None:
        return 0
    writer = AutomaticTabClient(client)
    tabs = TabStatus(writer, titles.state_dir)
    events = EventStream(getattr(client, "socket_path", None))
    current_root = _script_root()
    current_revision = revision(current_root)
    next_registration = 0.0
    next_poll = 0.0
    delay = INTERVAL
    last_error = ""
    with lock:
        while True:
            if finish_if_stopped(lock, titles.state_dir, tabs.clear):
                return 0
            now = time.monotonic()
            deadline = now + delay
            try:
                if now >= next_registration:
                    root = registered_root(client)
                    if root is None:
                        tabs.clear()
                        return 0
                    if root != current_root or revision(root) != current_revision:
                        replace(root, lock)
                        return 0
                    next_registration = now + REGISTRATION_INTERVAL
                if now >= next_poll:
                    config = Config.load()
                    titles.configure(config)
                    tabs.configure(config)
                    if not (titles.enabled or tabs.enabled):
                        tabs.clear()
                        events.close()
                        return 0
                    snapshot = titles.apply(tabs, tabs.snapshot())
                    next_poll = now + INTERVAL
                else:
                    snapshot = tabs.snapshot()
                deadline = next_poll
                tabs.apply(snapshot)
                if writer.conflict:
                    raise RenamingPluginDetected(writer.conflict)
                try:
                    events.follow(tabs.subscriptions())
                except HerdrError:
                    pass
                delay = INTERVAL
                last_error = ""
            except RenamingPluginDetected as error:
                print("herdr-bar: %s" % error, file=sys.stderr, flush=True)
                events.close()
                return 0
            except (HerdrError, OSError) as error:
                message = str(error)
                if message != last_error:
                    print("herdr-bar: title watcher retrying: %s" % message,
                          file=sys.stderr, flush=True)
                    last_error = message
                events.close()
                next_registration = next_poll = 0
                delay = min(MAX_BACKOFF, delay * 2)
                deadline = time.monotonic() + delay
            while time.monotonic() < deadline:
                if finish_if_stopped(lock, titles.state_dir, tabs.clear):
                    return 0
                if events.wait(min(1, max(0, deadline - time.monotonic()))):
                    next_poll = 0
                    break
