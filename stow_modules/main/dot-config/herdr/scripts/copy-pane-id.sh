#!/bin/sh
# Copy the focused pane's id to the clipboard and show a notification.
#
# Pane identity comes from $HERDR_ACTIVE_PANE_ID, which herdr auto-injects into
# custom commands (along with HERDR_SOCKET_PATH and HERDR_BIN_PATH). Note it is
# NOT $HERDR_PANE_ID -- that only exists inside a pane's interactive shell and is
# empty in this detached command context.

herdr="${HERDR_BIN_PATH:-herdr}"

pane="${HERDR_ACTIVE_PANE_ID}"
[ -n "$pane" ] || exit 1

printf '%s' "$pane" | pbcopy

"$herdr" notification show "Copied pane id" --body "$pane"
