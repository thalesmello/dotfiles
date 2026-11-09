#!/bin/bash
# Prompt for a shell command in a popup, then eval it in this same process.
#
# Two entrypoints share this script:
#   * Interactive (`ctrl+alt+shift+semicolon`): uses `prompt-lib.sh` for full
#     line editing, history, and bracketed paste.
#   * Automated callback (`ctrl+alt+shift+backslash`, `--callback`): used by
#     Hammerspoon (`ghosttyPreset.executeAndForgetHerdrCommand`). Avoids
#     sourcing libraries or starting Python before reading: it immediately puts
#     the tty into non-canonical no-echo mode, emits a pre-encoded OSC 52 ready
#     token (`\036HERDR_RUN_CMD_READY_V1:e4a91c7d3b6048f291c5d0a87e3b6f12\037`),
#     and reads the pasted command with builtin `read`.
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

if [ "${1:-}" = "--callback" ]; then
  stty -icanon -echo min 1 time 0 2>/dev/null
  # Base64 of "\036HERDR_RUN_CMD_READY_V1:e4a91c7d3b6048f291c5d0a87e3b6f12\037"
  printf 'Command: \033]52;c;HkhFUkRSX1JVTl9DTURfUkVBRFlfVjE6ZTRhOTFjN2QzYjYwNDhmMjkxYzVkMGE4N2UzYjZmMTIf\007'

  IFS= read -r -d '' -n 1 first || first=''
  if [ -z "$first" ] || [ "$first" = $'\r' ] || [ "$first" = $'\n' ] \
    || [ "$first" = $'\e' ] || [ "$first" = $'\003' ] \
    || [ "$first" = $'\004' ] || [ "$first" = $'\007' ]; then
    stty sane 2>/dev/null
    printf '\n'
    exit 0
  fi

  IFS= read -r rest
  stty sane 2>/dev/null

  cmd="${first}${rest%$'\r'}"
  cmd=${cmd#$'\e[200~'}
  cmd=${cmd%$'\e[201~'}
  cmd=${cmd%$'\r'}
  printf '%s\n' "$cmd"
  [ -n "$cmd" ] || exit 0

  script_dir="$(cd "$(dirname "$0")" && pwd)"
  . "$script_dir/herdr-lib.sh"
  herdr=$(herdr_bin) || herdr_die "run-command" "herdr CLI not found"
else
  script_dir="$(cd "$(dirname "$0")" && pwd)"
  . "$script_dir/herdr-lib.sh"
  . "$script_dir/prompt-lib.sh"

  herdr=$(herdr_bin) || herdr_die "run-command" "herdr CLI not found"

  prompt_line 'Command: ' || exit 0
  cmd=$PROMPT_LINE
  [ -n "$cmd" ] || exit 0
fi

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

if [ "${1:-}" = "--callback" ]; then
  printf '\n[exit %d] press any key to close ' "$status"
  IFS= read -rsn1 _
  printf '\n'
else
  prompt_any_key "$(printf '\n[exit %d] press any key to close ' "$status")"
fi
