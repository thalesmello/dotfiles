#!/usr/bin/env bash
# The single-line prompt shared by the herdr keys.command popups. bash, meant
# to be sourced:
#
#   . "$(dirname "$0")/prompt-lib.sh"
#   prompt_line 'Tab name: ' "$prefill" || exit 0   # non-zero == cancelled
#   name=$PROMPT_LINE
#
# This started as three copies of the same reader inlined in claude-tab.sh,
# run-command.sh and break-pane.sh; they all call in here now, so a fix (like
# bracketed paste, below) lands in every prompt at once. Reading the user is
# this file's whole job, and no other bash script here does any of it: a line
# is prompt_line, a keypress is prompt_any_key.
#
# The one deliberate exception is herdr_hold_on_tty in herdr-lib.sh, which
# waits for a keypress with its own byte read. It cannot call this: herdr-lib.sh
# is POSIX sh, sourced by seven #!/bin/sh scripts, and everything below is
# bash. Splitting it by interpreter would be two libraries again, so the copy
# stays where the sh scripts can reach it.
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
#   paste               inserted as text, however long (see below)
#
# Bytes come in through `dd`, not bash's `read`: ctrl+c has to arrive as data
# (0x03) rather than as SIGINT, and while `stty -isig` arranges exactly that,
# bash's `read` builtin puts ISIG back for the duration of each read, so ctrl+c
# would kill the prompt no matter what the terminal is set to. dd leaves the
# terminal settings alone.
#
# A lone Esc and an escape sequence (arrow keys, opt+backspace, a paste marker)
# all start with 0x1b, so after an Esc we peek with `min 0 time 1` -- a 0.1s
# read that returns empty when nothing follows -- to tell them apart.
#
# BRACKETED PASTE. Without it a paste is just fast typing, and the first newline
# in it submits the prompt with half the text -- the rest lands in whatever runs
# next. So the prompt turns paste mode on (DECSET 2004) for as long as it is
# open: the terminal then wraps pasted text in ESC[200~ ... ESC[201~, which is
# what lets this read the whole thing as one insert and never as an Enter. The
# body is read in 4K chunks rather than byte at a time (one `dd` per byte is a
# fork per byte -- fine for typing, not for a paragraph), and is flattened:
# newlines and tabs become spaces and other control bytes are dropped, because
# this is a one-line prompt and a multi-line paste has to become one line
# somehow.

# Read one byte and print its decimal value; empty if the read timed out.
_prompt_read_byte() { dd bs=1 count=1 2>/dev/null | od -An -tu1 | tr -dc '0-9'; }

# Same, but gives up after ~$1 tenths of a second (0 = whatever is already
# buffered).
_prompt_peek_byte() {
  stty min 0 time "${1:-0}"
  _prompt_read_byte
  stty min 1 time 0
}

# The bytes of a CSI sequence after its "[", up to and including the final byte
# (0x40-0x7e). The whole sequence arrives as one burst, so the rest of it is
# already buffered and needs no wait.
_prompt_csi_tail() {
  local _b _c _out=''
  while _b=$(_prompt_peek_byte); [ -n "$_b" ]; do
    _c=$(printf "\\$(printf '%03o' "$_b")")
    _out+=$_c
    if [ "$_b" -ge 64 ] && [ "$_b" -le 126 ]; then break; fi
  done
  printf '%s' "$_out"
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

# Everything up to the ESC[201~ that ends a paste, inserted at once.
_prompt_paste() {
  local _term=$'\e[201~' _chunk _text=''

  while :; do
    # min 1 time 1: block for the first byte of the chunk, then take whatever
    # else is already there and return within a tenth of a second of the burst
    # drying up. The X guard keeps the trailing newlines command substitution
    # would otherwise eat -- they are separators between pasted lines.
    stty min 1 time 1
    _chunk=$(dd bs=4096 count=1 2>/dev/null; printf X)
    stty min 1 time 0
    _chunk=${_chunk%X}

    [ -n "$_chunk" ] || break
    _text+=$_chunk

    case $_text in
      *"$_term"*) _text=${_text%%"$_term"*}; break ;;
    esac
  done

  # One line: newlines and tabs become spaces, anything else non-printable
  # (including a stray ESC) goes away.
  _text=$(printf '%s' "$_text" | tr '\r\n\t' '   ' | tr -d '[:cntrl:]')
  [ -n "$_text" ] || return 0

  PROMPT_LINE+=$_text
  printf '%s' "$_text"
}

# prompt_any_key [message]
# Wait for one keypress, e.g. to hold output on screen before a popup closes.
# Raw mode for the same reason as above -- otherwise "any key" means "Enter".
prompt_any_key() {
  local _old
  [ $# -gt 0 ] && printf '%s' "$1"

  _old=$(stty -g)
  stty -echo -icanon min 1 time 0
  _prompt_read_byte >/dev/null
  stty "$_old" 2>/dev/null || stty sane
}

# prompt_line <prompt> [prefill]
# Sets PROMPT_LINE to what was typed. Returns 0 when accepted with Enter,
# 1 when cancelled (Esc, or ctrl+c on an empty line).
prompt_line() {
  local _label=$1 _old _b _nxt _tail _c _cancelled=0
  PROMPT_LINE=${2-}

  printf '%s%s' "$_label" "$PROMPT_LINE"

  _old=$(stty -g)
  stty -echo -icanon -isig min 1 time 0
  printf '\e[?2004h'                  # bracketed paste on, for this prompt only

  while _b=$(_prompt_read_byte); [ -n "$_b" ]; do
    case $_b in
      27)                             # Esc: is another byte waiting?
        _nxt=$(_prompt_peek_byte 1)
        case $_nxt in
          '') _cancelled=1; break ;;  # lone Esc
          127) _prompt_erase_word ;;  # opt+backspace
          91)                         # CSI: a paste marker, or a key to ignore
            _tail=$(_prompt_csi_tail)
            [ "$_tail" = '200~' ] && _prompt_paste ;;
          # anything else (SS3 arrows, alt+key): drain what is buffered. A
          # terminal sends the sequence as one burst, so drain with no wait, or
          # the next real keystroke gets eaten as part of the sequence.
          *) while [ -n "$(_prompt_peek_byte)" ]; do :; done ;;
        esac ;;
      10|13) break ;;                 # Enter -> done
      127) _prompt_erase_char ;;      # Backspace
      23) _prompt_erase_word ;;       # ctrl+w
      21) _prompt_erase_line ;;       # ctrl+u
      3)                              # ctrl+c: clear, or cancel when empty
        if [ -n "$PROMPT_LINE" ]; then _prompt_erase_line; else _cancelled=1; break; fi ;;
      *)
        _c=$(printf "\\$(printf '%03o' "$_b")")
        PROMPT_LINE+=$_c; printf '%s' "$_c" ;;
    esac
  done

  printf '\e[?2004l'                  # paste mode off before anyone else reads
  stty "$_old" 2>/dev/null || stty sane
  printf '\n'

  [ "$_cancelled" -eq 0 ]
}
