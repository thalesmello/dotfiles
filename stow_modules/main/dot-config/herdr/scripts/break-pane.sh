#!/usr/bin/env bash
# prefix+shift+m: break the focused pane out of its split (tmux parity:
# `break-pane`), asking for the new name first.
#   - pane shares its tab with other panes -> move it to a new tab of the same
#     workspace, prompting for the tab name, prefilled with the pane's name.
#   - pane is already alone in its tab -> a new tab would look identical to what
#     you already have, so this is really the tab moving out: move it to a new
#     workspace instead, prompting for the workspace name prefilled with the
#     tab's name (the workspace's single tab gets the same name).
#
# The prefill is editable: the prompt starts with it typed in, so Enter keeps it
# and backspace whittles it down. A pane has no name until `pane rename`, so it
# falls back to what the sidebar shows for it -- its title, then its terminal
# title.
#
# herdr has no native action for either move, so this drives `pane move`. In
# both destinations --label names the thing being created (the new tab, or the
# new workspace); --tab-label names the tab inside a new workspace.
#
# Bound as a `type = "popup"` command so the prompt runs in a herdr-rendered PTY
# where interactive input works -- a detached `type = "shell"` command has no
# terminal. The popup is not a real pane, so the pane to move is
# HERDR_ACTIVE_PANE_ID (the pane focused when the binding fired), not whatever
# `pane layout --current` reports from in here.
#
# Esc cancels and moves nothing. Emptying the prompt and pressing Enter keeps
# herdr's generated name.

herdr="${HERDR_BIN_PATH:-herdr}"

pane="$HERDR_ACTIVE_PANE_ID"
[ -n "$pane" ] || { printf 'no focused pane\n'; sleep 1; exit 1; }

# Pane name (first of label/title/terminal title) + its tab, in one call.
info=$("$herdr" pane get "$pane" 2>/dev/null | python3 -c '
import sys, json, re
try:
    p = json.load(sys.stdin)["result"]["pane"]
    name = p.get("label") or p.get("title") or p.get("terminal_title_stripped") or ""
    # terminal_title_stripped keeps the agent state glyph ("* ", "◑ "); it is
    # decoration, not part of a name you would type.
    print(re.sub(r"^[^\x00-\x7f]+\s*", "", name))
    print(p.get("tab_id") or "")
except Exception:
    print("")
    print("")
')
pane_name=$(printf '%s\n' "$info" | sed -n 1p)
tab=$(printf '%s\n' "$info" | sed -n 2p)

# How many panes share that tab -- decides new tab vs new workspace.
count=$("$herdr" pane layout --pane "$pane" 2>/dev/null | python3 -c '
import sys, json
try:
    print(len(json.load(sys.stdin)["result"]["layout"].get("panes") or []))
except Exception:
    print(0)
')

if [ "$count" -gt 1 ]; then
  prompt='New tab name: '
  name=$pane_name
else
  prompt='New workspace name: '
  name=$("$herdr" tab get "$tab" 2>/dev/null | python3 -c '
import sys, json
try:
    print(json.load(sys.stdin)["result"]["tab"].get("label") or "")
except Exception:
    print("")
')
fi

# Read the name in raw mode so we can act on each keystroke. Editing keys:
#
#   backspace           delete a character
#   ctrl+w / opt+bs     delete a word (opt+backspace arrives as Esc DEL)
#   ctrl+u              clear the line
#   ctrl+c              clear the line; on an already-empty line, cancel
#   Esc                 cancel
#   Enter               accept
#
# Bytes come in through `dd`, not bash's `read`: ctrl+c has to arrive as data
# (0x03) rather than as SIGINT, and while `stty -isig` arranges exactly that,
# bash's `read` builtin puts ISIG back for the duration of each read, so ctrl+c
# would kill the prompt no matter what the terminal is set to. dd leaves the
# terminal settings alone.
#
# A lone Esc and an escape sequence (arrow keys, opt+backspace) both start with
# 0x1b, so after an Esc we peek with `min 0 time 1` -- a 0.1s read that returns
# empty when nothing follows -- to tell them apart.
printf '%s%s' "$prompt" "$name"

old=$(stty -g); stty -echo -icanon -isig min 1 time 0
trap 'stty "$old" 2>/dev/null || stty sane' EXIT

# Read one byte and print its decimal value; empty if the read timed out.
read_byte() { dd bs=1 count=1 2>/dev/null | od -An -tu1 | tr -dc '0-9'; }
peek_byte() {                         # same, but gives up after ~$1 tenths of a
  stty min 0 time "${1:-0}"           # second (0 = whatever is already buffered)
  read_byte
  stty min 1 time 0
}

erase_char() { [ -n "$name" ] && { name=${name%?}; printf '\b \b'; }; }
erase_line() { while [ -n "$name" ]; do erase_char; done; }
erase_word() {                        # trailing spaces, then the word itself
  while [ -n "$name" ] && [ "${name: -1}" = ' ' ]; do erase_char; done
  while [ -n "$name" ] && [ "${name: -1}" != ' ' ]; do erase_char; done
}

cancel() { printf '\n'; exit 0; }     # leave without moving anything

while b=$(read_byte); [ -n "$b" ]; do
  case $b in
    27)                               # Esc: is another byte waiting?
      nxt=$(peek_byte 1)
      case $nxt in
        '') cancel ;;                 # lone Esc
        127) erase_word ;;            # opt+backspace
        # arrow key etc: drain the rest of the sequence. A terminal sends it as
        # one burst, so the remaining bytes are already buffered -- drain with no
        # wait, or the next real keystroke gets eaten as part of the sequence.
        *) while [ -n "$(peek_byte)" ]; do :; done ;;
      esac ;;
    10|13) break ;;                   # Enter -> done
    127) erase_char ;;                # Backspace
    23) erase_word ;;                 # ctrl+w
    21) erase_line ;;                 # ctrl+u
    3)                                # ctrl+c: clear, or cancel when empty
      [ -n "$name" ] && erase_line || cancel ;;
    *)
      c=$(printf "\\$(printf '%03o' "$b")")
      name+=$c; printf '%s' "$c" ;;
  esac
done
printf '\n'

if [ "$count" -gt 1 ]; then
  set -- --new-tab
  [ -n "$name" ] && set -- "$@" --label "$name"
else
  set -- --new-workspace
  [ -n "$name" ] && set -- "$@" --label "$name" --tab-label "$name"
fi

"$herdr" pane move "$pane" "$@" --focus
