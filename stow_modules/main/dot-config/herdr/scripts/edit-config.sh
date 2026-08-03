#!/bin/sh
# Open the live Herdr config in a new tab for editing (prefix+e).
#
# Creates a focused tab, then launches $EDITOR (falling back to nvim) on
# config.toml inside its root pane. After saving, reload with prefix+shift+r
# (reload_config) to apply changes without restarting Herdr.

herdr="${HERDR_BIN_PATH:-herdr}"

config="${XDG_CONFIG_HOME:-$HOME/.config}/herdr/config.toml"

pane=$("$herdr" tab create --focus --label "herdr config" | jq -r '.result.root_pane.pane_id')
[ -n "$pane" ] && [ "$pane" != "null" ] || exit 1

# exec so the editor replaces the pane's shell: quitting it closes the pane
# (and the tab) instead of dropping back to fish. $EDITOR is expanded by the
# pane's fish shell, not this detached script.
"$herdr" pane run "$pane" exec '$EDITOR' "$config"
