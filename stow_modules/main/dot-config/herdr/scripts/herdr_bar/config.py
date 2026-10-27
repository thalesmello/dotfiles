"""User configuration.

Read from ``$HERDR_PLUGIN_CONFIG_DIR/config.json`` (or the XDG fallback
``~/.config/herdr/plugins/config/herdr-bar/config.json`` when invoked directly
as a standalone script). Unknown keys are ignored, and a broken file falls back
to defaults instead of taking the bar down.
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, Optional

VALID_SCOPES = ("all", "agent", "pane", "tab", "blocked", "action")

DEFAULTS: Dict[str, Any] = {
    # true | false (hidden until ^o) | "auto" (on when the popup is wide enough)
    "preview": "auto",
    "mouse": True,
    "agent_icons": "auto",  # "auto" | "font" | "none"
    "refresh_ms": 900,
    "workspaces": "auto",  # true | false | "auto" (on with more than one space)
    "colors": {},  # role -> "#rrggbb" | ansi name | 0-255
    "selection_background": "auto",  # "auto" | "none" | "#rrggbb" | 0-255
    "claude_config_dirs": [],  # extra CLAUDE_CONFIG_DIR roots holding transcripts
    "tab_renaming_plugins": [],  # additional plugin IDs that own tab names
    "auto_titles": True,  # task-based naming, guarded against other naming plugins
    "lowercase_titles": False,  # lowercase generated task titles only
    "follow_new_sessions": False,  # let next session in same pane take over auto title
    "tab_status": False,  # lead agent tab names with the vendor logo and status glyph (enabled in the version-controlled plugins/config/herdr-bar/config.json)
    "running_time": True,  # per-row running time; false skips the ps/process_info reading
    "scope": "all",  # opening filter: "all" | "agent" | "pane" | "tab" | "blocked" | "action"
    "select_current": False,  # open with the current row selected instead of previous
    "actions": False,  # list plugin actions as rows
}


def default_config_dir() -> str:
    # Env only, as upstream: herdr sets HERDR_PLUGIN_CONFIG_DIR for plugin
    # panes, and the standalone entry (herdr-bar.py) sets it when run
    # directly from a key binding. Tests therefore see no config/state
    # unless they set the vars, and never touch the real watcher's files.
    return os.environ.get("HERDR_PLUGIN_CONFIG_DIR") or ""


def default_state_dir() -> str:
    return os.environ.get("HERDR_PLUGIN_STATE_DIR") or ""


class Config(object):
    def __init__(self, values: Optional[Dict[str, Any]] = None) -> None:
        merged = dict(DEFAULTS)
        merged.update(values or {})
        self.preview = merged.get("preview", "auto")
        self.mouse = bool(merged.get("mouse", True))
        self.agent_icons = merged.get("agent_icons", "auto")
        try:
            self.refresh_ms = max(200, int(merged.get("refresh_ms", 900)))
        except (TypeError, ValueError):
            self.refresh_ms = 900
        self.workspaces = merged.get("workspaces", "auto")
        colors = merged.get("colors")
        self.colors = colors if isinstance(colors, dict) else {}
        self.selection_background = merged.get("selection_background", "auto")
        dirs = merged.get("claude_config_dirs")
        self.claude_config_dirs = [
            value for value in dirs if isinstance(value, str) and value.strip()
        ] if isinstance(dirs, list) else []
        renamers = merged.get("tab_renaming_plugins")
        self.tab_renaming_plugins = [
            value for value in renamers if isinstance(value, str) and value.strip()
        ] if isinstance(renamers, list) else []
        self.auto_titles = merged.get("auto_titles") is True
        self.lowercase_titles = merged.get("lowercase_titles") is True
        self.follow_new_sessions = merged.get("follow_new_sessions") is True
        self.tab_status = merged.get("tab_status") is True
        self.running_time = merged.get("running_time") is not False
        self.actions = merged.get("actions") is True
        self.select_current = merged.get("select_current") is True
        raw_scope = merged.get("scope", "all")
        self.scope = raw_scope if isinstance(raw_scope, str) and raw_scope in VALID_SCOPES else "all"
        if self.scope == "action" and not self.actions:
            self.scope = "all"

    @staticmethod
    def path(config_dir: Optional[str] = None) -> Optional[str]:
        directory = config_dir if config_dir is not None else default_config_dir()
        if not directory:
            return None
        return os.path.join(directory, "config.json")

    @classmethod
    def load(cls, config_dir: Optional[str] = None) -> "Config":
        path = cls.path(config_dir)
        if not path or not os.path.exists(path):
            return cls()
        try:
            with open(path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
        except (OSError, ValueError):
            return cls()
        if not isinstance(data, dict):
            return cls()
        return cls(data)

    def preview_starts_on(self) -> bool:
        """Whether the preview is showing before anyone presses ^o."""
        return self.preview is not False

    def fits_preview(
        self, available_width: int, chosen: bool = False, threshold: int = 92
    ) -> bool:
        """Whether the popup is wide enough to split a preview column off it."""
        if chosen or self.preview is True or self.preview is False:
            return available_width >= 60
        return available_width >= threshold

    def wants_workspaces(self, workspace_count: int) -> bool:
        if self.workspaces is True:
            return True
        if self.workspaces is False:
            return False
        return workspace_count > 1
