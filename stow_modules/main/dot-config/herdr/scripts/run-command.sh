#!/usr/bin/env bash
# Prompt for a shell command in a popup, then eval it in this same process.
#
# Bound to ctrl+alt+shift+semicolon in config.toml as a `type = "popup"` command
# so the prompt runs in a herdr-rendered PTY where interactive input works. The
# command is evaluated in this popup's own bash process; its output stays on
# screen until you press a key, then the popup closes.
#
# The prompt reads in raw mode so a lone Esc cancels immediately. Escape
# sequences (arrow keys, etc.) also start with 0x1b, so we peek for a follow-up
# byte with a tiny timeout to tell them apart. An empty command (just Enter)
# also cancels.

prompt='Command: '
cmd=''
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
        printf '\n'; exit 0           # lone Esc -> cancel, run nothing
      fi ;;
    ''|$'\n'|$'\r') break ;;          # Enter -> done
    $'\x7f')                          # Backspace
      [ -n "$cmd" ] && { cmd=${cmd%?}; printf '\b \b'; } ;;
    *) cmd+=$c; printf '%s' "$c" ;;
  esac
done

stty "$old"; trap - EXIT
printf '\n'
[ -n "$cmd" ] || exit 0

eval "$cmd"
status=$?

# Success -> close immediately. Error -> keep output on screen until a keypress.
[ "$status" -eq 0 ] && exit 0

printf '\n[exit %d — press any key to close]' "$status"
read -rsn1 _
