#!/bin/sh
# Open the live Herdr config for editing (prefix+shift+e).
#
# Bound as a `type = "shell"` command in config.toml. A full-screen popup would
# swallow the prefix key while the editor runs, so instead this opens a real
# vertical split, zooms it, and runs the editor there. The pane is exec'd, so
# quitting the editor closes the pane (and drops the zoom) automatically.
#
# Re-invokes itself with --edit inside the new pane; that branch runs the editor
# and reloads the config when it exits.

herdr="${HERDR_BIN_PATH:-herdr}"

config="${XDG_CONFIG_HOME:-$HOME/.config}/herdr/config.toml"

if [ "$1" = "--edit" ]; then
  "${EDITOR:-nvim}" "$config"
  command "$herdr" server reload-config
  exit 0
fi

pane="${HERDR_ACTIVE_PANE_ID}"
[ -n "$pane" ] || exit 1

new=$("$herdr" pane split "$pane" --direction right --ratio 0.5 --focus \
  | sed -n 's/.*"pane_id":"\([^"]*\)".*/\1/p' | head -1)
[ -n "$new" ] || exit 1

"$herdr" pane zoom "$new" --on

# exec so quitting the editor closes the pane instead of dropping back to fish.
"$herdr" pane run "$new" exec "$0" --edit
