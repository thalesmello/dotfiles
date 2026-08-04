#!/usr/bin/env bash
# Open a new tab running Claude Code, prompting for the tab name first.
#
# Bound to prefix+shift+c in config.toml as a `type = "popup"` command so the
# prompt runs in a herdr-rendered PTY where interactive input works. herdr
# injects HERDR_BIN_PATH into custom commands. An empty name falls back to
# "claude"; pressing Esc closes the popup without creating anything.

herdr="${HERDR_BIN_PATH:-herdr}"

# Prompt for the tab name in raw mode so we can act on each keystroke. A lone
# Esc cancels; escape sequences (arrow keys, etc.) also start with 0x1b, so we
# peek for a follow-up byte with a tiny timeout to tell them apart.
prompt='Tab name: '
name=''
printf '%s' "$prompt"

old=$(stty -g); stty -echo -icanon min 1 time 0
trap 'stty "$old"' EXIT

while IFS= read -rsn1 c; do
  case $c in
    $'\x1b')                          # Esc: is another byte waiting?
      if read -rsn1 -t 0.001 _; then
        # an escape sequence (arrow key, etc.) -- drain and ignore it
        while read -rsn1 -t 0.001 _; do :; done
      else
        printf '\n'; exit 0           # lone Esc -> cancel, create nothing
      fi ;;
    ''|$'\n'|$'\r') break ;;          # Enter -> done
    $'\x7f')                          # Backspace
      [ -n "$name" ] && { name=${name%?}; printf '\b \b'; } ;;
    *) name+=$c; printf '%s' "$c" ;;
  esac
done
printf '\n'

[ -n "$name" ] || name=claude

new=$("$herdr" tab create --label "$name" --focus \
  | sed -n 's/.*"pane_id":"\([^"]*\)".*/\1/p' | head -1)
[ -n "$new" ] || exit 1

# exec so leaving Claude closes the tab instead of dropping back to fish.
"$herdr" pane run "$new" exec claude
