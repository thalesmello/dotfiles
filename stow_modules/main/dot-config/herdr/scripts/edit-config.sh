#!/bin/sh
# Open the live Herdr config in a new tab for editing (prefix+e).
#
# Creates a focused tab, then launches $EDITOR (falling back to nvim) on
# config.toml inside its root pane. When the editor exits, the config is
# reloaded automatically (herdr server reload-config) and the pane/tab closes.

herdr="${HERDR_BIN_PATH:-herdr}"

config="${XDG_CONFIG_HOME:-$HOME/.config}/herdr/config.toml"

pane=$("$herdr" tab create --focus --label "herdr config" | jq -r '.result.root_pane.pane_id')
[ -n "$pane" ] && [ "$pane" != "null" ] || exit 1

# Run the editor, then reload the config, then let the shell exit so the pane
# (and tab) closes instead of dropping back to fish. exec fish -c keeps the
# whole chain as the pane's single foreground process; $EDITOR and the herdr
# path are expanded by the pane's fish, not by this detached script.
"$herdr" pane run "$pane" exec fish -c \
  "\$EDITOR $config; command $herdr server reload-config"
