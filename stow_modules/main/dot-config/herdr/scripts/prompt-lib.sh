#!/usr/bin/env bash
# Shared single-line prompt for the herdr keys.command popups. bash, meant to
# be sourced:
#
#   . "$(dirname "$0")/prompt-lib.sh"
#   prompt_line 'Tab name: ' "$prefill" || exit 0   # non-zero == cancelled
#   name=$PROMPT_LINE
#
# Only a `type = "popup"` binding can use this: a popup is a herdr-rendered PTY,
# and a detached `type = "shell"` command has no terminal to read from at all.
#
# The prefill is editable -- it starts typed in, so Enter keeps it and backspace
# whittles it down.
#
# Editing keys:
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

# Read one byte and print its decimal value; empty if the read timed out.
_prompt_read_byte() { dd bs=1 count=1 2>/dev/null | od -An -tu1 | tr -dc '0-9'; }

# Same, but gives up after ~$1 tenths of a second (0 = whatever is already
# buffered).
_prompt_peek_byte() {
  stty min 0 time "${1:-0}"
  _prompt_read_byte
  stty min 1 time 0
}

# These edit PROMPT_LINE in place -- it is the accumulator prompt_line builds,
# kept in a global so the helpers can reach it.
_prompt_erase_char() {
  [ -n "$PROMPT_LINE" ] && { PROMPT_LINE=${PROMPT_LINE%?}; printf '\b \b'; }
}

_prompt_erase_line() { while [ -n "$PROMPT_LINE" ]; do _prompt_erase_char; done; }

_prompt_erase_word() {   # trailing spaces, then the word itself
  while [ -n "$PROMPT_LINE" ] && [ "${PROMPT_LINE: -1}" = ' ' ]; do _prompt_erase_char; done
  while [ -n "$PROMPT_LINE" ] && [ "${PROMPT_LINE: -1}" != ' ' ]; do _prompt_erase_char; done
}

# prompt_line <prompt> [prefill]
# Sets PROMPT_LINE to what was typed. Returns 0 when accepted with Enter,
# 1 when cancelled (Esc, or ctrl+c on an empty line).
prompt_line() {
  local _label=$1 _old _b _nxt _c _cancelled=0
  PROMPT_LINE=${2-}

  printf '%s%s' "$_label" "$PROMPT_LINE"

  _old=$(stty -g)
  stty -echo -icanon -isig min 1 time 0

  while _b=$(_prompt_read_byte); [ -n "$_b" ]; do
    case $_b in
      27)                               # Esc: is another byte waiting?
        _nxt=$(_prompt_peek_byte 1)
        case $_nxt in
          '') _cancelled=1; break ;;    # lone Esc
          127) _prompt_erase_word ;;    # opt+backspace
          # arrow key etc: drain the rest of the sequence. A terminal sends it
          # as one burst, so the remaining bytes are already buffered -- drain
          # with no wait, or the next real keystroke gets eaten as part of the
          # sequence.
          *) while [ -n "$(_prompt_peek_byte)" ]; do :; done ;;
        esac ;;
      10|13) break ;;                   # Enter -> done
      127) _prompt_erase_char ;;        # Backspace
      23) _prompt_erase_word ;;         # ctrl+w
      21) _prompt_erase_line ;;         # ctrl+u
      3)                                # ctrl+c: clear, or cancel when empty
        if [ -n "$PROMPT_LINE" ]; then _prompt_erase_line; else _cancelled=1; break; fi ;;
      *)
        _c=$(printf "\\$(printf '%03o' "$_b")")
        PROMPT_LINE+=$_c; printf '%s' "$_c" ;;
    esac
  done

  stty "$_old" 2>/dev/null || stty sane
  printf '\n'

  [ "$_cancelled" -eq 0 ]
}
