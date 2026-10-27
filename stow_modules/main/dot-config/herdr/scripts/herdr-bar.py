#!/usr/bin/env python3
"""Entry point for the Herdr command bar and background tab title/status watcher.

Vendored Python port of https://github.com/jeffarese/herdr-bar.
Runs directly from config.toml (type = "popup") without requiring a Rust build
or `herdr plugin install`.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# When herdr runs this as a plugin pane it sets HERDR_PLUGIN_CONFIG_DIR and
# HERDR_PLUGIN_STATE_DIR. A direct key-binding popup gets neither, so
# provide the same locations here (the package itself stays env-only).
_config_home = os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config")
_state_home = os.environ.get("XDG_STATE_HOME") or os.path.expanduser("~/.local/state")
os.environ.setdefault(
    "HERDR_PLUGIN_CONFIG_DIR", os.path.join(_config_home, "herdr", "plugins", "config", "herdr-bar"))
os.environ.setdefault(
    "HERDR_PLUGIN_STATE_DIR", os.path.join(_state_home, "herdr", "plugins", "herdr-bar"))

if __name__ == "__main__":
    if sys.argv[1:] == ["--open"]:
        from herdr_bar.opener import open_bar
        raise SystemExit(open_bar())
    from herdr_bar.cli import main
    raise SystemExit(main(sys.argv[1:]))
