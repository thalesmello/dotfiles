#!/bin/sh
# Open a new vertical (side-by-side) split at 40% width running Pi.
#
# Bound to prefix+c in config.toml as a `type = "shell"` command. herdr injects
# HERDR_ACTIVE_PANE_ID (the pane focused when the keybinding fired) and
# HERDR_BIN_PATH into custom commands.
#
# `pane split --ratio` is the ORIGINAL pane's fraction, so 0.6 leaves the source
# pane at 60% and gives the new pi pane 40% of the width.

. "$(dirname "$0")/herdr-lib.sh"

herdr=$(herdr_bin) || exit 1

pane="${HERDR_ACTIVE_PANE_ID}"
[ -n "$pane" ] || exit 1

new=$("$herdr" pane split "$pane" --direction right --ratio 0.6 --focus \
  | sed -n 's/.*"pane_id":"\([^"]*\)".*/\1/p' | head -1)
[ -n "$new" ] || exit 1

# exec so leaving Pi closes the pane instead of dropping back to fish.
"$herdr" pane run "$new" exec pi
