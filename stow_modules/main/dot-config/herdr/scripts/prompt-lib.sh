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
#   ctrl+shift+_ / ctrl+_              undo last edit
#   ctrl+l                             redraw the line
#   shift+enter, alt+enter             insert a newline
#   enter                              accept
#   esc                                clear the line; cancel when empty
#   ctrl+g                             cancel
#   ctrl+c                             clear the line; cancel when empty
#   paste                              inserted at the cursor, however long
#
# Kills go to a one-slot kill ring, so ctrl+w/ctrl+u/ctrl+k then ctrl+y is the
# usual "move this text elsewhere" move. Edits go onto a simple undo stack;
# ctrl+shift+_ walks back through it, whether the terminal collapses that to
# ctrl+_ or spells it out as c-s-_ via modifyOtherKeys / CSI-u.
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
# MODIFIED ENTER. The prompt asks the terminal for Kitty keyboard reporting
# while it is open so Shift+Enter / Alt+Enter arrive as distinct CSI-u keypresses
# where supported. The prompt disables CR-to-LF translation while it is open so
# plain Enter remains CR (submit), and LF can be used as a Shift+Enter fallback.
# It also accepts ESC+CR/LF for Alt+Enter.
#
# BRACKETED PASTE. Without it a paste is just fast typing, and the first newline
# in it submits the prompt with half the text -- the rest lands in whatever runs
# next. So the prompt turns paste mode on (DECSET 2004) for as long as it is
# open: the terminal then wraps pasted text in ESC[200~ ... ESC[201~, which is
# what lets this read the whole thing as one insert and never as an Enter. The
# body is read in 4K chunks rather than byte at a time (one `dd` per byte is a
# fork per byte -- fine for typing, not for a paragraph). Newlines are preserved
# for multiline prompts, tabs become spaces, and other control bytes are dropped.
#
# CHARACTERS. Positions and widths are counted with bash's ${#s} and ${s:i:n},
# which are character-based under a UTF-8 locale and byte-based under C. Typed
# multi-byte input is assembled into whole characters before insertion either
# way, so the buffer is never left holding half a character; under a C locale a
# non-ASCII character just counts as its bytes when the cursor moves over it.
#
# LONG INPUT. The buffer is not limited to the width or height of the popup: the
# visible window scrolls horizontally and vertically to keep the cursor on
# screen, so a long or multiline prompt stays editable in a small popup.

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

_prompt_save_undo() {                  # remember the state before an edit
  _prompt_undo_lines+=("$PROMPT_LINE")
  _prompt_undo_pos+=("$_prompt_pos")
}

_prompt_undo() {                       # restore the previous edited state
  local _n=${#_prompt_undo_lines[@]}
  [ "$_n" -gt 0 ] || return 0

  _n=$((_n - 1))
  PROMPT_LINE=${_prompt_undo_lines[$_n]}
  _prompt_pos=${_prompt_undo_pos[$_n]}
  _prompt_undo_lines=("${_prompt_undo_lines[@]:0:_n}")
  _prompt_undo_pos=("${_prompt_undo_pos[@]:0:_n}")
}

_prompt_insert() {                     # insert text at the cursor
  local _t=$1
  [ -n "$_t" ] || return 0
  _prompt_save_undo
  PROMPT_LINE="${PROMPT_LINE:0:_prompt_pos}$_t${PROMPT_LINE:_prompt_pos}"
  _prompt_pos=$((_prompt_pos + ${#_t}))
}

# delete $2 chars at index $1. A third argument means "this was a kill": it
# goes to the kill ring for ctrl+y. Plain backspace/delete does not, same as
# readline -- otherwise a stray backspace would clobber the text you were
# about to yank.
_prompt_delete() {
  local _at=$1 _len=$2 _ring=${3-} _n=${#PROMPT_LINE}
  [ "$_len" -gt 0 ] || return 0
  [ "$_at" -ge 0 ] || return 0
  [ "$_at" -lt "$_n" ] || return 0
  [ $((_at + _len)) -gt "$_n" ] && _len=$((_n - _at))
  [ -n "$_ring" ] && _prompt_kill=${PROMPT_LINE:_at:_len}
  _prompt_save_undo
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
  local _mode=$1 _end _word _old_word
  _end=$(_prompt_word_fwd "$_prompt_pos")
  [ "$_end" -gt "$_prompt_pos" ] || return 0
  _old_word=${PROMPT_LINE:_prompt_pos:_end - _prompt_pos}
  _word=$_old_word

  case $_mode in
    up)   _word=${_word^^} ;;
    down) _word=${_word,,} ;;
    cap)  _word=${_word,,}
          # first alphanumeric of the word, not of the slice: " foo" -> " Foo"
          local _lead=${_word%%[[:alnum:]]*}
          local _rest=${_word#"$_lead"}
          _word="$_lead${_rest^}" ;;
  esac

  if [ "$_word" != "$_old_word" ]; then
    _prompt_save_undo
    PROMPT_LINE="${PROMPT_LINE:0:_prompt_pos}$_word${PROMPT_LINE:_end}"
  fi
  _prompt_pos=$_end
}

_prompt_transpose() {                  # ctrl+t: swap the chars around the cursor
  local _n=${#PROMPT_LINE} _at=$_prompt_pos _a _b
  [ "$_n" -ge 2 ] || return 0
  [ "$_at" -ge "$_n" ] && _at=$((_n - 1))   # at end of line: swap the last two
  [ "$_at" -ge 1 ] || return 0
  _a=${PROMPT_LINE:_at-1:1}
  _b=${PROMPT_LINE:_at:1}
  [ "$_a" != "$_b" ] && _prompt_save_undo
  PROMPT_LINE="${PROMPT_LINE:0:_at-1}$_b$_a${PROMPT_LINE:_at+1}"
  _prompt_pos=$((_at + 1))
}

# Throw the buffer away, keeping it on the undo stack so ctrl+_ brings it back.
_prompt_clear_buffer() {
  _prompt_save_undo
  PROMPT_LINE=''
  _prompt_pos=0
  _prompt_start=0
  _prompt_top_line=0
}

# Esc, wherever it arrives from (a lone 0x1b or CSI 27u): the first press wipes
# what was typed, and Esc on an already-empty prompt cancels -- which for a
# popup binding is what closes the window. Returns 1 when it means cancel.
_prompt_esc_key() {
  [ -n "$PROMPT_LINE" ] || return 1
  _prompt_clear_buffer
}

# --- rendering --------------------------------------------------------------

# Multiline, redrawn from scratch after every keystroke, with a window that
# scrolls to follow the cursor when the buffer is wider or taller than the
# popup.
_prompt_split_lines() {
  local _s=$1 _line
  _prompt_render_lines=()
  while [[ $_s == *$'\n'* ]]; do
    _line=${_s%%$'\n'*}
    _prompt_render_lines+=("$_line")
    _s=${_s#*$'\n'}
  done
  _prompt_render_lines+=("$_s")
}

_prompt_cursor_line_and_col() {
  local _before _s
  _before=${PROMPT_LINE:0:_prompt_pos}
  _s=$_before
  _prompt_cursor_line=0
  while [[ $_s == *$'\n'* ]]; do
    _prompt_cursor_line=$((_prompt_cursor_line + 1))
    _s=${_s#*$'\n'}
  done
  _prompt_cursor_col=${#_s}
}

_prompt_clear_previous_render() {
  local _old_rows=${_prompt_render_rows:-0} _old_cursor_row=${_prompt_cursor_screen_row:-0} _i
  [ "$_old_rows" -gt 0 ] || return 0

  [ "$_old_cursor_row" -gt 0 ] && printf '\e[%dA' "$_old_cursor_row"
  printf '\r'
  for ((_i = 0; _i < _old_rows; _i++)); do
    printf '\e[K'
    [ "$_i" -lt $((_old_rows - 1)) ] && printf '\n'
  done
  [ "$_old_rows" -gt 1 ] && printf '\e[%dA' $((_old_rows - 1))
  printf '\r'
}

_prompt_render_single_line() {
  local _avail _shown _tail

  if [ "${_prompt_render_rows:-0}" -gt 1 ] || [ "${_prompt_cursor_screen_row:-0}" -gt 0 ]; then
    _prompt_clear_previous_render
  else
    printf '\r'
  fi

  _avail=$((_prompt_cols - ${#_prompt_label} - 1))
  [ "$_avail" -lt 8 ] && _avail=8

  [ "$_prompt_pos" -lt "$_prompt_start" ] && _prompt_start=$_prompt_pos
  [ "$_prompt_pos" -gt $((_prompt_start + _avail)) ] \
    && _prompt_start=$((_prompt_pos - _avail))
  [ "$_prompt_start" -lt 0 ] && _prompt_start=0

  _shown=${PROMPT_LINE:_prompt_start:_avail}
  printf '%s%s\e[K' "$_prompt_label" "$_shown"

  _tail=$((_prompt_start + ${#_shown} - _prompt_pos))
  [ "$_tail" -gt 0 ] && printf '\e[%dD' "$_tail"
  _prompt_render_rows=1
  _prompt_cursor_screen_row=0
}

_prompt_render() {
  local _visible_rows _line_count _i _line_index _line _prefix _prefix_width
  local _avail _start _shown _target_row=0 _target_col=0 _up

  if [[ $PROMPT_LINE != *$'\n'* ]]; then
    _prompt_render_single_line
    return 0
  fi

  printf '\e[?25l'
  _prompt_clear_previous_render
  _prompt_split_lines "$PROMPT_LINE"
  _prompt_cursor_line_and_col

  [ -n "$_prompt_rows" ] && [ "$_prompt_rows" -gt 0 ] 2>/dev/null || _prompt_rows=1
  _visible_rows=$_prompt_rows
  [ "$_visible_rows" -lt 1 ] && _visible_rows=1

  [ -n "$_prompt_top_line" ] || _prompt_top_line=0
  [ "$_prompt_cursor_line" -lt "$_prompt_top_line" ] && _prompt_top_line=$_prompt_cursor_line
  if [ "$_prompt_cursor_line" -ge $((_prompt_top_line + _visible_rows)) ]; then
    _prompt_top_line=$((_prompt_cursor_line - _visible_rows + 1))
  fi
  [ "$_prompt_top_line" -lt 0 ] && _prompt_top_line=0

  _line_count=${#_prompt_render_lines[@]}
  _prompt_render_rows=$_visible_rows
  [ "$_line_count" -lt "$_prompt_render_rows" ] && _prompt_render_rows=$_line_count

  for ((_i = 0; _i < _prompt_render_rows; _i++)); do
    _line_index=$((_prompt_top_line + _i))
    _line=${_prompt_render_lines[$_line_index]}
    if [ "$_line_index" -eq 0 ]; then
      _prefix=$_prompt_label
    else
      _prefix=$(printf '%*s' "${#_prompt_label}" '')
    fi
    _prefix_width=${#_prefix}
    _avail=$((_prompt_cols - _prefix_width - 1))
    [ "$_avail" -lt 8 ] && _avail=8

    if [ "$_line_index" -eq "$_prompt_cursor_line" ]; then
      [ "$_prompt_cursor_col" -lt "$_prompt_start" ] && _prompt_start=$_prompt_cursor_col
      [ "$_prompt_cursor_col" -gt $((_prompt_start + _avail)) ] \
        && _prompt_start=$((_prompt_cursor_col - _avail))
      [ "$_prompt_start" -lt 0 ] && _prompt_start=0
      _start=$_prompt_start
      _target_row=$_i
      _target_col=$((_prefix_width + _prompt_cursor_col - _start))
    else
      _start=0
    fi

    _shown=${_line:_start:_avail}
    printf '%s%s\e[K' "$_prefix" "$_shown"
    [ "$_i" -lt $((_prompt_render_rows - 1)) ] && printf '\n'
  done

  _up=$((_prompt_render_rows - 1 - _target_row))
  [ "$_up" -gt 0 ] && printf '\e[%dA' "$_up"
  printf '\r'
  [ "$_target_col" -gt 0 ] && printf '\e[%dC' "$_target_col"
  _prompt_cursor_screen_row=$_target_row
  printf '\e[?25h'
  return 0
}

_prompt_finish_render() {
  local _down
  printf '\e[?25h'
  if [ "${_prompt_render_rows:-0}" -gt 0 ]; then
    _down=$((_prompt_render_rows - 1 - _prompt_cursor_screen_row))
    [ "$_down" -gt 0 ] && printf '\e[%dB' "$_down"
  fi
  printf '\r\n'
}

_prompt_render_after_edit() {
  local _old=$1 _old_pos=$2 _inserted _deleted _line_count _col
  local _label_spaces

  if [ "$_old" = "$PROMPT_LINE" ] && [ "$_old_pos" -eq "$_prompt_pos" ]; then
    return 0
  fi

  # Fast path for the common case: appending at the end. This edits the screen
  # instead of clearing and repainting the prompt on every typed character.
  if [ "$_old_pos" -eq "${#_old}" ] \
    && [ "$_prompt_pos" -eq "${#PROMPT_LINE}" ] \
    && [[ $PROMPT_LINE == "$_old"* ]]; then
    _inserted=${PROMPT_LINE:${#_old}}
    _prompt_split_lines "$PROMPT_LINE"
    _line_count=${#_prompt_render_lines[@]}
    if [ "$_line_count" -le "$_prompt_rows" ]; then
      _label_spaces=$(printf '%*s' "${#_prompt_label}" '')
      while [ -n "$_inserted" ]; do
        case ${_inserted:0:1} in
          $'\n')
            _prompt_cursor_screen_row=$((_prompt_cursor_screen_row + 1))
            _prompt_render_rows=$((_prompt_render_rows + 1))
            printf '\n%s' "$_label_spaces" ;;
          *)
            printf '%s' "${_inserted:0:1}" ;;
        esac
        _inserted=${_inserted:1}
      done
      return 0
    fi
  fi

  # Fast path for backspace at the end, including deleting an empty line created
  # by Shift+Enter. This avoids the full redraw path that can make the popup look
  # like it vanished when deleting blank multiline rows.
  if [ "$_old_pos" -eq "${#_old}" ] \
    && [ "$_prompt_pos" -eq "${#PROMPT_LINE}" ] \
    && [ "${_old:0:${#PROMPT_LINE}}" = "$PROMPT_LINE" ] \
    && [ $((${#_old} - ${#PROMPT_LINE})) -eq 1 ]; then
    _deleted=${_old: -1}
    if [ "$_deleted" = $'\n' ] && [ "$_prompt_cursor_screen_row" -gt 0 ]; then
      _prompt_cursor_screen_row=$((_prompt_cursor_screen_row - 1))
      [ "$_prompt_render_rows" -gt 1 ] && _prompt_render_rows=$((_prompt_render_rows - 1))
      _prompt_cursor_line_and_col
      _col=$((${#_prompt_label} + _prompt_cursor_col))
      printf '\r\e[K\e[1A\r'
      [ "$_col" -gt 0 ] && printf '\e[%dC' "$_col"
      return 0
    elif [ "$_deleted" != $'\n' ]; then
      printf '\b \b'
      return 0
    fi
  fi

  _prompt_render
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

  # Multiline prompts keep pasted line breaks. Normalize CRLF/CR line endings
  # first so Windows-style pasted text does not create blank lines between every
  # pasted line. Tabs become spaces and anything else non-printable (including a
  # stray ESC) goes away.
  _text=${_text//$'\r\n'/$'\n'}
  _text=${_text//$'\r'/$'\n'}
  _text=${_text//$'\t'/ }
  _text=$(printf '%s' "$_text" | tr -d '\000-\010\013\014\016-\037\177')
  _prompt_insert "$_text"
}

_prompt_insert_newline() { _prompt_insert $'\n'; }

# --- escape sequences -------------------------------------------------------

# Prompt control keys can arrive as Kitty CSI-u or xterm modifyOtherKeys while
# modified-key reporting is enabled. Handle the same editing keys as the legacy
# byte path, plus modified Enter as an in-buffer newline.
_prompt_csi_prompt_key() {
  local _tail=$1 _body _mods _key _event=1 _after_mod _mod_bits _code _lower _at

  case $_tail in
    *u)
      _body=${_tail%u}
      _key=${_body%%;*}
      if [ "$_body" != "${_body#*;}" ]; then
        _body=${_body#*;}
        _mods=${_body%%[;:]*}
        _after_mod=${_body#"$_mods"}
        case $_after_mod in
          :*) _event=${_after_mod#:}; _event=${_event%%;*} ;;
        esac
      else
        # No modifier parameter at all. Herdr sends a bare Esc as "CSI 27u",
        # and the spec's default for an omitted modifier is 1 (none held) --
        # not "unparseable". Rejecting it here is what made Esc do nothing.
        _mods=1
      fi ;;
    27\;*\;*~)
      _body=${_tail%\~}
      _body=${_body#27;}
      _mods=${_body%%;*}
      _key=${_body#*;}
      _key=${_key%%;*} ;;
    *) return 1 ;;
  esac

  case $_mods in
    ''|*[!0-9]*) return 1 ;;
  esac
  _mod_bits=$((_mods - 1))

  # Consume key releases so a release event cannot repeat an edit.
  [ "$_event" = 3 ] && return 0

  for _code in ${_key//:/ }; do
    case $_code in
      8|127)
        # alt+backspace / ctrl+backspace kill the word before the cursor, the
        # same as ctrl+w; unmodified backspace deletes one character.
        if [ $((_mod_bits & 6)) -ne 0 ]; then
          _at=$(_prompt_word_back "$_prompt_pos")
          _prompt_delete "$_at" $((_prompt_pos - _at)) kill
        else
          _prompt_delete $((_prompt_pos - 1)) 1
        fi
        return 0 ;;
      13|57414)
        if [ $((_mod_bits & 3)) -ne 0 ]; then
          _prompt_insert_newline
        else
          _prompt_accept=1
        fi
        return 0 ;;
      27)
        _prompt_esc_key || _prompt_cancel=1
        return 0 ;;
    esac

    # Ctrl-modified ASCII controls. Shift may be present too (e.g. Ctrl+Shift+_).
    [ $((_mod_bits & 4)) -ne 0 ] || continue
    _lower=$_code
    [ "$_lower" -ge 65 ] 2>/dev/null && [ "$_lower" -le 90 ] && _lower=$((_lower + 32))
    case $_lower in
      97) _prompt_pos=0; return 0 ;;                                             # ctrl+a
      98) [ "$_prompt_pos" -gt 0 ] && _prompt_pos=$((_prompt_pos - 1)); return 0 ;; # ctrl+b
      99)                                                                        # ctrl+c
        _prompt_esc_key || _prompt_cancel=1
        return 0 ;;
      100)                                                                       # ctrl+d
        if [ -z "$PROMPT_LINE" ]; then _prompt_cancel=1; else _prompt_delete "$_prompt_pos" 1; fi
        return 0 ;;
      101) _prompt_pos=${#PROMPT_LINE}; return 0 ;;                              # ctrl+e
      102) [ "$_prompt_pos" -lt "${#PROMPT_LINE}" ] && _prompt_pos=$((_prompt_pos + 1)); return 0 ;; # ctrl+f
      103) _prompt_cancel=1; return 0 ;;                                         # ctrl+g
      104|127) _prompt_delete $((_prompt_pos - 1)) 1; return 0 ;;                # ctrl+h/backspace
      107) _prompt_delete "$_prompt_pos" $((${#PROMPT_LINE} - _prompt_pos)) kill; return 0 ;; # ctrl+k
      108) return 0 ;;                                                           # ctrl+l redraw
      116) _prompt_transpose; return 0 ;;                                        # ctrl+t
      117) _prompt_delete 0 "$_prompt_pos" kill; return 0 ;;                    # ctrl+u
      119) _at=$(_prompt_word_back "$_prompt_pos"); _prompt_delete "$_at" $((_prompt_pos - _at)) kill; return 0 ;; # ctrl+w
      121) _prompt_insert "$_prompt_kill"; return 0 ;;                          # ctrl+y
      31|45|47|63|95) _prompt_undo; return 0 ;;                                 # ctrl+_
    esac
  done

  return 1
}

# Printable ctrl chords can arrive as kitty CSI-u (95;6u, 45:95;6u) or xterm's
# modifyOtherKeys (27;6;95~). For undo accept the common spellings terminals use
# for ctrl+_ / ctrl+shift+_: _, -, / and ?.
_prompt_csi_undo() {
  local _tail=$1 _body _mods _key _code

  case $_tail in
    *u)
      _body=${_tail%u}
      [ "$_body" != "$_tail" ] || return 1
      [ "$_body" != "${_body#*;}" ] || return 1
      _key=${_body%%;*}
      _body=${_body#*;}
      _mods=${_body%%[;:]*} ;;
    27\;*\;*~)
      _body=${_tail%\~}
      _body=${_body#27;}
      _mods=${_body%%;*}
      _key=${_body#*;}
      _key=${_key%%;*} ;;
    *) return 1 ;;
  esac

  case $_mods in
    5|6) ;;
    *) return 1 ;;
  esac

  for _code in ${_key//:/ }; do
    case $_code in
      31|45|47|63|95)
        _prompt_undo
        return 0 ;;
    esac
  done

  return 1
}

# Esc has already been read. Returns 1 to cancel the prompt (a lone Esc).
_prompt_escape() {
  local _nxt _tail _at _mod _mod_bits

  _nxt=$(_prompt_peek_byte 1)
  case $_nxt in
    '') _prompt_esc_key || return 1 ;; # lone Esc -> clear, or cancel when empty
    10|13) _prompt_insert_newline ;;   # alt+enter / alt+shift+enter
    91)                                # CSI: arrows, home/end, delete, paste
      _tail=$(_prompt_csi_tail)
      case $_tail in
        200~) _prompt_paste ;;
        *u|27\;*\;*~) _prompt_csi_prompt_key "$_tail" || _prompt_csi_undo "$_tail" || : ;;
        C|D|[0-9]*C|[0-9]*D)           # left / right, plain or modified
          # The modifier is the last parameter: "1;3D" (alt+left), "1;5C"
          # (ctrl+right), bare "3D" on terminals that drop the leading 1, and a
          # ":1" event suffix under the kitty protocol. alt or ctrl makes the
          # arrow a word motion; anything else moves one character.
          _mod=${_tail%[CD]}
          _mod=${_mod##*;}
          _mod=${_mod%%:*}
          _mod_bits=0
          [ -n "$_mod" ] && [ "$_mod" -ge 1 ] 2>/dev/null && _mod_bits=$((_mod - 1))
          if [ $((_mod_bits & 6)) -ne 0 ]; then
            case $_tail in
              *C) _prompt_pos=$(_prompt_word_fwd "$_prompt_pos") ;;
              *)  _prompt_pos=$(_prompt_word_back "$_prompt_pos") ;;
            esac
          else
            case $_tail in
              *C) [ "$_prompt_pos" -lt "${#PROMPT_LINE}" ] && _prompt_pos=$((_prompt_pos + 1)) ;;
              *)  [ "$_prompt_pos" -gt 0 ] && _prompt_pos=$((_prompt_pos - 1)) ;;
            esac
          fi ;;
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
    127|8)                                                        # alt+backspace
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
  _prompt_top_line=0
  _prompt_render_rows=0
  _prompt_cursor_screen_row=0
  _prompt_accept=0
  _prompt_cancel=0
  _prompt_kill=''
  _prompt_undo_lines=()
  _prompt_undo_pos=()
  _prompt_rows=$(stty size 2>/dev/null | awk '{ print $1 }')
  _prompt_cols=$(stty size 2>/dev/null | awk '{ print $2 }')
  [ -n "$_prompt_rows" ] && [ "$_prompt_rows" -gt 0 ] 2>/dev/null || _prompt_rows=${LINES:-1}
  [ -n "$_prompt_cols" ] && [ "$_prompt_cols" -gt 0 ] 2>/dev/null || _prompt_cols=${COLUMNS:-80}

  _old=$(stty -g)
  stty -echo -icanon -isig -icrnl min 1 time 0
  printf '\e[?2004h\e[>5u'             # bracketed paste + modified-key reporting for this prompt only
  _prompt_render

  while _b=$(_prompt_read_byte); [ -n "$_b" ]; do
    _prompt_old_line=$PROMPT_LINE
    _prompt_old_pos=$_prompt_pos
    case $_b in
      27)
        _prompt_escape || { _cancelled=1; break; }
        [ "$_prompt_cancel" -eq 1 ] && { _cancelled=1; break; }
        [ "$_prompt_accept" -eq 1 ] && break ;;
      10) _prompt_insert_newline ;;                    # Shift+Enter / bare LF -> newline
      13) break ;;                                     # Enter -> accept
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
      31) _prompt_undo ;;                              # ctrl+shift+_ / ctrl+_
      12) : ;;                                         # ctrl+l: the render below
      7) _cancelled=1; break ;;                        # ctrl+g: abort
      3)                                               # ctrl+c: clear, else cancel
        _prompt_esc_key || { _cancelled=1; break; } ;;
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

    _prompt_render_after_edit "$_prompt_old_line" "$_prompt_old_pos"
  done

  printf '\e[<u\e[?2004l'              # restore keyboard protocol and paste mode before anyone else reads
  stty "$_old" 2>/dev/null || stty sane
  _prompt_finish_render

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
