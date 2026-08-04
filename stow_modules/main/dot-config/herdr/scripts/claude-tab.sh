#!/bin/sh
# Open a new tab running Claude Code.
#
# Bound to prefix+shift+c in config.toml as a `type = "shell"` command. herdr
# injects HERDR_BIN_PATH into custom commands. Passing --label skips the
# interactive new-tab name prompt (prompt_new_tab_name) that the UI action uses.

herdr="${HERDR_BIN_PATH:-herdr}"

new=$("$herdr" tab create --label claude --focus \
  | sed -n 's/.*"pane_id":"\([^"]*\)".*/\1/p' | head -1)
[ -n "$new" ] || exit 1

# exec so leaving Claude closes the tab instead of dropping back to fish.
"$herdr" pane run "$new" exec claude
