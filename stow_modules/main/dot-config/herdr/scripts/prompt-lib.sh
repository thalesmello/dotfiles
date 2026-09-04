#!/usr/bin/env bash
# The line editor shared by the herdr keys.command popups: the one place here
# that reads the user. bash, meant to be sourced:
#
#   . "$(dirname "$0")/prompt-lib.sh"
#   prompt_line 'Tab name: ' "$prefill" || exit 0   # non-zero == cancelled
#   name=$PROMPT_LINE
#
# This started as three copies of a getline inlined in claude-tab.sh,
# run-command.sh and break-pane.sh; they all call in here now, so a fix (like
# bracketed paste or the cursor movement below) lands in every prompt at once.
# A line is prompt_line, a keypress is prompt_any_key, and no other bash script
# in this directory touches the terminal.
#
# The one deliberate exception is herdr_hold_on_tty in herdr-lib.sh, which waits
# for a keypress with its own byte read. It cannot call this: herdr-lib.sh is
# POSIX sh, sourced by seven #!/bin/sh scripts, and everything below is bash.
# Splitting it by interpreter would be two libraries again, so that copy stays
# where the sh scripts can reach it.
#
# Only a `type = "popup"` binding can use this: a popup is a herdr-rendered PTY,
# and a detached `type = "shell"` command has no terminal to read from at all.
#
# WHY NOT `read -e`. bash's readline gives all of this for free, and cannot be
# used here for two reasons: `read` re-enables ISIG for the duration of the
# read, so ctrl+c kills the popup instead of arriving as data (see below), and
# readline's own SIGWINCH/redraw handling fights herdr's popup surface. So the
# editing is implemented, and the bindings are readline's.
#
# EDITING. The buffer is a real buffer: the cursor moves through it and every
# operation applies at the cursor, not just at the end.
#
#   left / right, ctrl+b / ctrl+f      char left / right
#   alt+left / alt+right, alt+b / f    word left / right
#   ctrl+left / ctrl+right             word left / right
#   home / end, ctrl+a / ctrl+e        start / end of line
#   backspace, ctrl+h                  delete char before cursor
#   delete, ctrl+d                     delete char under cursor
#                                      (ctrl+d on an empty line: EOF, cancel)
#   ctrl+w, alt+backspace              kill word before cursor
#   alt+d                              kill word after cursor
#   ctrl+u                             kill to start of line
#   ctrl+k                             kill to end of line
#   ctrl+y                             yank back the last kill
#   ctrl+t                             transpose the two chars at the cursor
#   alt+u / alt+l / alt+c              upcase / downcase / capitalize word
#   ctrl+l                             redraw the line
#   enter                              accept
#   esc, ctrl+g                        cancel
#   ctrl+c                             clear the line; cancel when empty
#   paste                              inserted at the cursor, however long
#
# Kills go to a one-slot kill ring, so ctrl+w/ctrl+u/ctrl+k then ctrl+y is the
# usual "move this text elsewhere" move.
#
# BYTES, NOT `read`. ctrl+c has to arrive as data (0x03) rather than as SIGINT,
# and while `stty -isig` arranges exactly that, bash's `read` builtin puts ISIG
# back for the duration of each read, so ctrl+c would kill the prompt no matter
# what the terminal is set to. `dd` leaves the terminal settings alone.
#
# A lone Esc, an escape sequence (arrows, home/end) and a meta chord (alt+b is
# ESC b) all start with 0x1b, so after an Esc we peek with `min 0 time 1` -- a
# 0.1s read that returns empty when nothing follows -- to tell a bare Esc from
# the start of something longer.
#
# BRACKETED PASTE. Without it a paste is just fast typing, and the first newline
# in it submits the prompt with half the text -- the rest lands in whatever runs
# next. So the prompt turns paste mode on (DECSET 2004) for as long as it is
# open: the terminal then wraps pasted text in ESC[200~ ... ESC[201~, which is
# what lets this read the whole thing as one insert and never as an Enter. The
# body is read in 4K chunks rather than byte at a time (one `dd` per byte is a
# fork per byte -- fine for typing, not for a paragraph), and is flattened:
# newlines and tabs become spaces and other control bytes are dropped, because
# this is a one-line buffer and a multi-line paste has to become one line
# somehow.
#
# CHARACTERS. Positions and widths are counted with bash's ${#s} and ${s:i:n},
# which are character-based under a UTF-8 locale and byte-based under C. Typed
# multi-byte input is assembled into whole characters before insertion either
# way, so the buffer is never left holding half a character; under a C locale a
# non-ASCII character just counts as its bytes when the cursor moves over it.
#
# LONG LINES. The buffer is not limited to the width of the popup: the visible
# window scrolls horizontally to keep the cursor on screen, so a pasted
# paragraph is editable in a 3-row popup.

# --- byte input -------------------------------------------------------------

# Read one byte and print its decimal value; empty if the read timed out.
_prompt_read_byte() { dd bs=1 count=1 2>/dev/null | od -An -tu1 | tr -dc '0-9'; }

# Same, but gives up after ~$1 tenths of a second (0 = whatever is already
# buffered).
_prompt_peek_byte() {
  stty min 0 time "${1:-0}"
  _prompt_read_byte
  stty min 1 time 0
}

# A byte's decimal value -> that byte.
_prompt_byte_char() { printf '%b' "\\$(printf '%03o' "$1")"; }

# The whole character whose first byte is $1: UTF-8 lead bytes pull in their
# continuation bytes (which are already buffered -- they arrive in one burst),
# so an insert is never half a character.
_prompt_read_char() {
  local _lead=$1 _need=0 _seq _b
  if   [ "$_lead" -ge 240 ]; then _need=3
  elif [ "$_lead" -ge 224 ]; then _need=2
  elif [ "$_lead" -ge 194 ]; then _need=1
  fi

  _seq="\\$(printf '%03o' "$_lead")"
  while [ "$_need" -gt 0 ]; do
    _b=$(_prompt_peek_byte 1)
    [ -n "$_b" ] || break
    _seq+="\\$(printf '%03o' "$_b")"
    _need=$((_need - 1))
  done

  printf '%b' "$_seq"
}

# The bytes of a CSI sequence after its "[", up to and including the final byte
# (0x40-0x7e). The whole sequence arrives as one burst, so the rest of it is
# already buffered and needs no wait.
_prompt_csi_tail() {
  local _b _out=''
  while _b=$(_prompt_peek_byte); [ -n "$_b" ]; do
    _out+=$(_prompt_byte_char "$_b")
    if [ "$_b" -ge 64 ] && [ "$_b" -le 126 ]; then break; fi
  done
  printf '%s' "$_out"
}

# --- the buffer -------------------------------------------------------------
#
# PROMPT_LINE is the buffer (and the result), _prompt_pos the cursor's index in
# it. Globals, so the operations below can be one-liners that any of the key
# handlers can call.

_prompt_insert() {                     # insert text at the cursor
  local _t=$1
  [ -n "$_t" ] || return 0
  PROMPT_LINE="${PROMPT_LINE:0:_prompt_pos}$_t${PROMPT_LINE:_prompt_pos}"
  _prompt_pos=$((_prompt_pos + ${#_t}))
}

# delete $2 chars at index $1. A third argument means "this was a kill": it
# goes to the kill ring for ctrl+y. Plain backspace/delete does not, same as
# readline -- otherwise a stray backspace would clobber the text you were
# about to yank.
_prompt_delete() {
  local _at=$1 _len=$2 _ring=${3-}
  [ "$_len" -gt 0 ] || return 0
  [ -n "$_ring" ] && _prompt_kill=${PROMPT_LINE:_at:_len}
  PROMPT_LINE="${PROMPT_LINE:0:_at}${PROMPT_LINE:_at + _len}"
  [ "$_prompt_pos" -gt "$_at" ] && _prompt_pos=$_at
}

# Word boundaries, readline's definition: alphanumerics are the word, anything
# else is separator.
_prompt_word_back() {                  # index of the start of the word left of $1
  local _i=$1
  while [ "$_i" -gt 0 ] && [[ ${PROMPT_LINE:_i-1:1} != [[:alnum:]] ]]; do _i=$((_i - 1)); done
  while [ "$_i" -gt 0 ] && [[ ${PROMPT_LINE:_i-1:1} == [[:alnum:]] ]]; do _i=$((_i - 1)); done
  printf '%s' "$_i"
}

_prompt_word_fwd() {                   # index of the end of the word right of $1
  local _i=$1 _n=${#PROMPT_LINE}
  while [ "$_i" -lt "$_n" ] && [[ ${PROMPT_LINE:_i:1} != [[:alnum:]] ]]; do _i=$((_i + 1)); done
  while [ "$_i" -lt "$_n" ] && [[ ${PROMPT_LINE:_i:1} == [[:alnum:]] ]]; do _i=$((_i + 1)); done
  printf '%s' "$_i"
}

# alt+u / alt+l / alt+c: recase from the cursor to the end of the word, and
# leave the cursor there, like readline.
_prompt_case_word() {
  local _mode=$1 _end _word
  _end=$(_prompt_word_fwd "$_prompt_pos")
  [ "$_end" -gt "$_prompt_pos" ] || return 0
  _word=${PROMPT_LINE:_prompt_pos:_end - _prompt_pos}

  case $_mode in
    up)   _word=${_word^^} ;;
    down) _word=${_word,,} ;;
    cap)  _word=${_word,,}
          # first alphanumeric of the word, not of the slice: " foo" -> " Foo"
          local _lead=${_word%%[[:alnum:]]*}
          local _rest=${_word#"$_lead"}
          _word="$_lead${_rest^}" ;;
  esac

  PROMPT_LINE="${PROMPT_LINE:0:_prompt_pos}$_word${PROMPT_LINE:_end}"
  _prompt_pos=$_end
}

_prompt_transpose() {                  # ctrl+t: swap the chars around the cursor
  local _n=${#PROMPT_LINE} _at=$_prompt_pos _a _b
  [ "$_n" -ge 2 ] || return 0
  [ "$_at" -ge "$_n" ] && _at=$((_n - 1))   # at end of line: swap the last two
  [ "$_at" -ge 1 ] || return 0
  _a=${PROMPT_LINE:_at-1:1}
  _b=${PROMPT_LINE:_at:1}
  PROMPT_LINE="${PROMPT_LINE:0:_at-1}$_b$_a${PROMPT_LINE:_at+1}"
  _prompt_pos=$((_at + 1))
}

# --- rendering --------------------------------------------------------------

# One line, redrawn from scratch after every keystroke, with a window that
# scrolls to follow the cursor when the buffer is wider than the popup.
_prompt_render() {
  local _avail=$((_prompt_cols - ${#_prompt_label} - 1)) _shown _tail
  [ "$_avail" -lt 8 ] && _avail=8

  [ "$_prompt_pos" -lt "$_prompt_start" ] && _prompt_start=$_prompt_pos
  [ "$_prompt_pos" -gt $((_prompt_start + _avail)) ] \
    && _prompt_start=$((_prompt_pos - _avail))
  [ "$_prompt_start" -lt 0 ] && _prompt_start=0

  _shown=${PROMPT_LINE:_prompt_start:_avail}
  printf '\r%s%s\e[K' "$_prompt_label" "$_shown"

  _tail=$((_prompt_start + ${#_shown} - _prompt_pos))
  [ "$_tail" -gt 0 ] && printf '\e[%dD' "$_tail"
  return 0
}

# --- paste ------------------------------------------------------------------

# Everything up to the ESC[201~ that ends a paste, inserted at the cursor.
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
  _prompt_insert "$_text"
}

# --- escape sequences -------------------------------------------------------

# Esc has already been read. Returns 1 to cancel the prompt (a lone Esc).
_prompt_escape() {
  local _nxt _tail _at

  _nxt=$(_prompt_peek_byte 1)
  case $_nxt in
    '') return 1 ;;                    # lone Esc -> cancel
    91)                                # CSI: arrows, home/end, delete, paste
      _tail=$(_prompt_csi_tail)
      case $_tail in
        200~) _prompt_paste ;;
        C|1\;*C)                       # right / ctrl+right / alt+right
          case $_tail in
            C) [ "$_prompt_pos" -lt "${#PROMPT_LINE}" ] && _prompt_pos=$((_prompt_pos + 1)) ;;
            *) _prompt_pos=$(_prompt_word_fwd "$_prompt_pos") ;;
          esac ;;
        D|1\;*D)                       # left / ctrl+left / alt+left
          case $_tail in
            D) [ "$_prompt_pos" -gt 0 ] && _prompt_pos=$((_prompt_pos - 1)) ;;
            *) _prompt_pos=$(_prompt_word_back "$_prompt_pos") ;;
          esac ;;
        H|1~|1\;*H) _prompt_pos=0 ;;                     # home
        F|4~|1\;*F) _prompt_pos=${#PROMPT_LINE} ;;       # end
        3~) _prompt_delete "$_prompt_pos" 1 ;;           # delete
        3\;*~)                                           # alt/ctrl+delete
          _at=$(_prompt_word_fwd "$_prompt_pos")
          _prompt_delete "$_prompt_pos" $((_at - _prompt_pos)) kill ;;
        A|B) : ;;                      # up/down: no history to walk
        *) : ;;                        # anything else: consumed and ignored
      esac ;;
    79)                                # SS3 (application cursor keys)
      _nxt=$(_prompt_peek_byte)
      case $_nxt in
        67) [ "$_prompt_pos" -lt "${#PROMPT_LINE}" ] && _prompt_pos=$((_prompt_pos + 1)) ;;  # C
        68) [ "$_prompt_pos" -gt 0 ] && _prompt_pos=$((_prompt_pos - 1)) ;;                  # D
        72) _prompt_pos=0 ;;                                                                 # H
        70) _prompt_pos=${#PROMPT_LINE} ;;                                                   # F
      esac ;;
    # meta chords: alt+key arrives as Esc key
    98|66)  _prompt_pos=$(_prompt_word_back "$_prompt_pos") ;;   # alt+b
    102|70) _prompt_pos=$(_prompt_word_fwd "$_prompt_pos") ;;    # alt+f
    100)                                                          # alt+d
      _at=$(_prompt_word_fwd "$_prompt_pos")
      _prompt_delete "$_prompt_pos" $((_at - _prompt_pos)) kill ;;
    127)                                                          # alt+backspace
      _at=$(_prompt_word_back "$_prompt_pos")
      _prompt_delete "$_at" $((_prompt_pos - _at)) kill ;;
    117) _prompt_case_word up ;;                                  # alt+u
    108) _prompt_case_word down ;;                                # alt+l
    99)  _prompt_case_word cap ;;                                 # alt+c
    *) while [ -n "$(_prompt_peek_byte)" ]; do :; done ;;         # unknown: drain
  esac

  return 0
}

# --- the prompt -------------------------------------------------------------

# prompt_line <prompt> [prefill]
# Sets PROMPT_LINE to the edited buffer. Returns 0 when accepted with Enter,
# 1 when cancelled (Esc, ctrl+g, ctrl+d on an empty line, or ctrl+c on one).
prompt_line() {
  local _old _b _c _at _cancelled=0

  _prompt_label=$1
  PROMPT_LINE=${2-}
  _prompt_pos=${#PROMPT_LINE}
  _prompt_start=0
  _prompt_kill=''
  _prompt_cols=$(stty size 2>/dev/null | awk '{ print $2 }')
  [ -n "$_prompt_cols" ] && [ "$_prompt_cols" -gt 0 ] 2>/dev/null || _prompt_cols=${COLUMNS:-80}

  _old=$(stty -g)
  stty -echo -icanon -isig min 1 time 0
  printf '\e[?2004h'                   # bracketed paste on, for this prompt only
  _prompt_render

  while _b=$(_prompt_read_byte); [ -n "$_b" ]; do
    case $_b in
      27) _prompt_escape || { _cancelled=1; break; } ;;
      10|13) break ;;                                  # Enter -> accept
      1) _prompt_pos=0 ;;                              # ctrl+a
      5) _prompt_pos=${#PROMPT_LINE} ;;                # ctrl+e
      2) [ "$_prompt_pos" -gt 0 ] && _prompt_pos=$((_prompt_pos - 1)) ;;                     # ctrl+b
      6) [ "$_prompt_pos" -lt "${#PROMPT_LINE}" ] && _prompt_pos=$((_prompt_pos + 1)) ;;     # ctrl+f
      127|8) _prompt_delete $((_prompt_pos - 1)) 1 ;;  # backspace / ctrl+h
      4)                                               # ctrl+d: delete, or EOF
        if [ -z "$PROMPT_LINE" ]; then _cancelled=1; break; fi
        _prompt_delete "$_prompt_pos" 1 ;;
      23)                                              # ctrl+w
        _at=$(_prompt_word_back "$_prompt_pos")
        _prompt_delete "$_at" $((_prompt_pos - _at)) kill ;;
      21) _prompt_delete 0 "$_prompt_pos" kill ;;      # ctrl+u: kill to start
      11)                                              # ctrl+k: kill to end
        _prompt_delete "$_prompt_pos" $((${#PROMPT_LINE} - _prompt_pos)) kill ;;
      25) _prompt_insert "$_prompt_kill" ;;            # ctrl+y
      20) _prompt_transpose ;;                         # ctrl+t
      12) : ;;                                         # ctrl+l: the render below
      7) _cancelled=1; break ;;                        # ctrl+g: abort
      3)                                               # ctrl+c: clear, else cancel
        if [ -n "$PROMPT_LINE" ]; then
          PROMPT_LINE=''; _prompt_pos=0; _prompt_start=0
        else
          _cancelled=1; break
        fi ;;
      *)
        # Any other control byte is not text; ignore it rather than inserting a
        # character the terminal will not draw.
        if [ "$_b" -lt 32 ]; then
          :
        else
          _c=$(_prompt_read_char "$_b")
          _prompt_insert "$_c"
        fi ;;
    esac

    _prompt_render
  done

  printf '\e[?2004l'                   # paste mode off before anyone else reads
  stty "$_old" 2>/dev/null || stty sane
  printf '\n'

  [ "$_cancelled" -eq 0 ]
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
