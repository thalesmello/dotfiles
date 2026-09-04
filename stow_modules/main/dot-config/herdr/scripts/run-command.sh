#!/usr/bin/env bash
# Prompt for a shell command in a popup, then eval it in this same process.
#
# Bound to ctrl+alt+shift+semicolon in config.toml as a `type = "popup"` command
# so the prompt runs in a herdr-rendered PTY where interactive input works. The
# command is evaluated in this popup's own bash process; its output stays on
# screen until you press a key, then the popup closes.
#
# Anything the command does to panes must act on the pane that was focused when
# the keybinding fired, NOT on this popup:
#
#   * HERDR_ACTIVE_PANE_ID is that pane (herdr injects it into custom commands)
#     and is what `herdr-preset open-file-with-fallback` anchors its split on, so
#     the new nvim split lands next to the pane you were looking at.
#   * HERDR_PANE_ID is unset before the eval, so a command that falls back to it
#     (herdr-preset does, for the case where it is run straight from a pane
#     shell) anchors on nothing rather than silently on the popup. A popup is not
#     a real pane -- `herdr pane list` from inside one does not include it -- so
#     nothing else depends on that variable here.
#   * The eval runs in that pane's cwd, so a relative path typed at the prompt
#     resolves the way it would if you had typed it in the pane.
#
# The command line comes from the shared popup prompt (prompt-lib.sh): raw-mode
# line editing, Esc to cancel, and bracketed paste -- pasting a long command in
# here used to submit at its first newline and leave the tail behind. An empty
# command (just Enter) cancels too.

. "$(cd "$(dirname "$0")" && pwd)/prompt-lib.sh"

herdr="${HERDR_BIN_PATH:-herdr}"

prompt_line 'Command: ' || exit 0
cmd=$PROMPT_LINE
[ -n "$cmd" ] || exit 0

# Hand the invoking pane, not the popup, to whatever gets run.
if [ -n "$HERDR_ACTIVE_PANE_ID" ]; then
  unset HERDR_PANE_ID
  pane_cwd=$("$herdr" pane get "$HERDR_ACTIVE_PANE_ID" 2>/dev/null \
    | sed -n 's/.*"foreground_cwd":"\([^"]*\)".*/\1/p' | head -1)
  [ -n "$pane_cwd" ] && cd "$pane_cwd" 2>/dev/null
fi

eval "$cmd"
status=$?

# Success -> close immediately. Error -> keep output on screen until a keypress.
[ "$status" -eq 0 ] && exit 0

prompt_any_key "$(printf '\n[exit %d] press any key to close ' "$status")"
