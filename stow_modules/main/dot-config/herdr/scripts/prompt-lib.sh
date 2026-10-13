#!/usr/bin/env bash
# Shell compatibility layer for the herdr popup prompt.
#
# The old implementation lived here and did raw line editing in bash.  That
# meant a lot of helper processes while the prompt was active.  The editor now
# runs in prompt-lib.py, using only Python's stdlib.  This file keeps the sourced
# API that the popup scripts use:
#
#   . "$(dirname "$0")/prompt-lib.sh"
#   prompt_line 'Tab name: ' "$prefill" || exit 0
#   name=$PROMPT_LINE

_prompt_lib_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
_prompt_lib_py=$_prompt_lib_dir/prompt-lib.py
_prompt_lib_python=${PROMPT_LIB_PYTHON:-python3}

_prompt_temp_file() {
  local _base=${TMPDIR:-/tmp}/prompt-lib.${BASHPID:-$$}.$RANDOM.$RANDOM.$1
  : >"$_base" || return 1
  printf '%s' "$_base"
}

# prompt_line <prompt> [prefill] [history-name]
# Sets PROMPT_LINE to the edited buffer. Returns 0 when accepted with Enter,
# 1 when cancelled (Esc, ctrl+g, ctrl+d on an empty line, or ctrl+c on one).
# History is stored under ~/.local/state/prompt-lib/<history-name>/ unless
# PROMPT_LIB_HISTORY=0 disables it. PROMPT_LIB_HISTORY_NAME overrides the name.
prompt_line() {
  local _result _status _history_name

  PROMPT_CANCELLED_BY_KEY=0
  _result=$(_prompt_temp_file result) || return 1

  if [ -n "${PROMPT_LIB_HISTORY_NAME:-}" ]; then
    _history_name=$PROMPT_LIB_HISTORY_NAME
  elif [ "$#" -ge 3 ]; then
    _history_name=$3
  else
    _history_name=${1-}
  fi

  PROMPT_LIB_RESULT_FILE=$_result \
    "$_prompt_lib_python" "$_prompt_lib_py" line "${1-}" "${2-}" "$_history_name"
  _status=$?

  if [ "$_status" -eq 0 ]; then
    # Bash command substitution strips trailing newlines. read -d '' keeps them;
    # it returns non-zero at EOF, so ignore the status.
    IFS= read -r -d '' PROMPT_LINE <"$_result" || true
    PROMPT_CANCELLED_BY_KEY=0
  else
    PROMPT_CANCELLED_BY_KEY=1
  fi

  rm -f "$_result"
  return "$_status"
}

# prompt_any_key [message]
# Wait for one keypress, e.g. to hold output on screen before a popup closes.
prompt_any_key() {
  "$_prompt_lib_python" "$_prompt_lib_py" any-key "${1-}"
}

_prompt_exit_hold_on_error() {
  local _status=$?

  # Only the shell that sourced prompt-lib should hold. Command substitutions and
  # subshells may also exit non-zero while parsing prompt state; never pause them.
  [ "${BASHPID:-$$}" = "${_prompt_exit_hold_pid:-}" ] || return "$_status"

  # A prompt-cancel key is intentional close behaviour, not an error to read.
  if [ "$_status" -ne 0 ] \
    && [ "${PROMPT_CANCELLED_BY_KEY:-0}" -ne 1 ] \
    && [ "${PROMPT_HOLD_ON_ERROR:-1}" != 0 ] \
    && [ -t 0 ] && [ -t 1 ]; then
    prompt_any_key "$(printf '\n[exit %d] press any key to close ' "$_status")"
  fi

  return "$_status"
}

_prompt_install_exit_hold() {
  [ "${_prompt_exit_hold_installed:-0}" -eq 1 ] && return 0
  _prompt_exit_hold_installed=1
  _prompt_exit_hold_pid=${BASHPID:-$$}
  PROMPT_CANCELLED_BY_KEY=0
  trap _prompt_exit_hold_on_error EXIT
}

# prompt-lib is intended for non-interactive popup scripts. Install the hold by
# default there, but do not surprise someone who sources this by hand.
case $- in
  *i*) ;;
  *) _prompt_install_exit_hold ;;
esac
