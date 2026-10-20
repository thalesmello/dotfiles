#!/usr/bin/env bash
# Open a new tab running Claude Code, prompting for the tab name first.
#
# Bound to prefix+shift+c in config.toml as a `type = "popup"` command so the
# prompt runs in a herdr-rendered PTY where interactive input works. herdr
# injects HERDR_BIN_PATH into custom commands. An empty name falls back to
# "claude"; pressing Esc closes the popup without creating anything.

script_dir="$(cd "$(dirname "$0")" && pwd)"
. "$script_dir/herdr-lib.sh"
. "$script_dir/prompt-lib.sh"

herdr=$(herdr_bin) || herdr_die "claude-tab" "herdr CLI not found"

prompt_line 'Tab name: ' || exit 0    # Esc -> cancel, create nothing
name=$PROMPT_LINE

[ -n "$name" ] || name=claude

new=$("$herdr" tab create --label "$name" --focus \
  | sed -n 's/.*"pane_id":"\([^"]*\)".*/\1/p' | head -1)
[ -n "$new" ] || exit 1

# exec so leaving Claude closes the tab instead of dropping back to fish.
"$herdr" pane run "$new" exec claude
