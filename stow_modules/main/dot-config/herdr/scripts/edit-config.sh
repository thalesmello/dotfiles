#!/bin/sh
# Open the live Herdr config in a new tab for editing (prefix+e).
#
# Creates a focused tab, then launches $EDITOR (falling back to nvim) on
# config.toml inside its root pane. After saving, reload with prefix+shift+r
# (reload_config) to apply changes without restarting Herdr.

herdr="${HERDR_BIN_PATH:-herdr}"

config="${XDG_CONFIG_HOME:-$HOME/.config}/herdr/config.toml"
editor="${EDITOR:-nvim}"

pane=$("$herdr" tab create --focus --label "herdr config" | jq -r '.result.root_pane.pane_id')
[ -n "$pane" ] && [ "$pane" != "null" ] || exit 1

"$herdr" pane run "$pane" "$editor" "$config"
