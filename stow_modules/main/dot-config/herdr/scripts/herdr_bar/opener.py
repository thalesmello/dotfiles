"""Open the bar's popup through the Herdr CLI and resolve the Herdr binary."""

from __future__ import annotations

import os
import shutil
import sys
from typing import List, Optional

POPUP_ARGS = [
    "plugin", "pane", "open", "--plugin", "herdr-bar", "--entrypoint", "bar",
    "--placement", "popup",
]


def herdr_bin() -> str:
    """The Herdr binary to shell out to."""
    candidate = os.environ.get("HERDR_BIN_PATH")
    if candidate and os.path.isfile(candidate) and os.access(candidate, os.X_OK):
        return candidate
    resolved = shutil.which("herdr")
    if resolved:
        return resolved
    for fallback in (
        os.path.expanduser("~/.local/bin/herdr"),
        "/opt/homebrew/bin/herdr",
        "/usr/local/bin/herdr",
    ):
        if os.path.isfile(fallback) and os.access(fallback, os.X_OK):
            return fallback
    return "herdr"


def default_socket_path() -> Optional[str]:
    candidate = os.environ.get("HERDR_SOCKET_PATH")
    if candidate:
        return candidate
    for fallback in (
        os.path.expanduser("~/.config/herdr/herdr.sock"),
        os.path.expanduser("~/.local/state/herdr/herdr.sock"),
    ):
        if os.path.exists(fallback):
            return fallback
    return None


def popup_command() -> List[str]:
    return [herdr_bin()] + POPUP_ARGS


def open_bar() -> int:
    command = popup_command()
    try:
        if sys.platform == "win32":
            import subprocess
            return subprocess.run(command, check=False).returncode
        os.execvp(command[0], command)
    except OSError as error:
        sys.stderr.write("herdr-bar: could not run herdr: %s\n" % error)
        return 2
    return 0
