#!/bin/sh
# Open the live Herdr config for editing (prefix+shift+e).
#
# Bound as a `type = "popup"` command in config.toml so the editor runs in a
# herdr-rendered PTY (full-screen popup) instead of a new tab. When the editor
# exits, the config is reloaded automatically and the popup closes.

herdr="${HERDR_BIN_PATH:-herdr}"

config="${XDG_CONFIG_HOME:-$HOME/.config}/herdr/config.toml"

"${EDITOR:-nvim}" "$config"

command "$herdr" server reload-config
