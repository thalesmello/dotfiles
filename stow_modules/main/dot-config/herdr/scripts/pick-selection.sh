#!/bin/sh
# Pick something out of the focused pane's recent output and act on it.
#
#   pick-selection.sh open   -> pick exactly one match and open it (file in nvim,
#                               url in Chrome, plus the work-specific id shapes
#                               on a Meta box), by way of Hammerspoon
#   pick-selection.sh copy   -> copy every pick to the clipboard as plain text
#
# Two roles in one file, like run-command.sh:
#
#   pick-selection.sh <mode>              launcher -- what prefix+o / prefix+y
#                                         run as `type = "shell"` commands. Makes
#                                         a zoomed split and starts the picker in
#                                         it, then exits.
#   pick-selection.sh <mode> <src-pane>   the picker itself, running in that
#                                         split, reading <src-pane>'s output.
#
# The picker (`workflow-preset pick-selections`, a wrapper around rxpick) is a
# curses UI, so it needs a herdr-RENDERED PTY -- hence a real pane rather than a
# detached command. A rendered PTY is also what makes the copy mode work over
# `herdr --remote`: herdr intercepts the OSC 52 escape on the pane and forwards
# the payload to the ATTACHED CLIENT's clipboard, whereas pbcopy would write to
# the herdr *server* host's clipboard. See copy-last-output.sh for the longer
# version of that story.
#
# The split is made with `exec`, so quitting the picker closes it.
#
# --source recent-unwrapped is what gets fed to the picker: recent scrollback
# with soft-wrapped lines rejoined, so a path or url that the pane broke across
# two rows still matches as one token.
#
# The pane to pick FROM is $HERDR_ACTIVE_PANE_ID in the launcher (herdr injects
# it into keys.command entries) and is then passed explicitly to the picker --
# inside the split, $HERDR_PANE_ID is the split itself, not the pane you came
# from.
#
# Both halves run somewhere nothing is readable -- a detached command, then a
# pane that closes the moment the picker exits -- so every failure is reported
# through herdr_die (a herdr notification) instead of stderr. See herdr-lib.sh,
# which also explains why the herdr CLI has to be resolved rather than assumed
# on PATH, and why the resolved path is passed into the split.

. "$(dirname "$0")/herdr-lib.sh"

herdr=$(herdr_bin) || herdr_die "pick-selection" \
    "herdr CLI not found (HERDR_BIN_PATH unset and no herdr on PATH)"

mode="${1:-open}"
pane="${2:-}"

if [ -z "$pane" ]; then
    src="${HERDR_ACTIVE_PANE_ID}"
    [ -n "$src" ] || herdr_die "pick-selection" \
        "HERDR_ACTIVE_PANE_ID is unset -- no pane to pick from"

    # Absolute path: `pane run` hands the command to the split's shell, which
    # has its own cwd (and would re-expand a leading ~).
    self=$(cd "$(dirname "$0")" 2>/dev/null && pwd)/$(basename "$0")

    split_out=$("$herdr" pane split "$src" --direction right --focus \
        --env "HERDR_BIN_PATH=$herdr" 2>&1)
    new=$(printf '%s' "$split_out" \
        | sed -n 's/.*"pane_id":"\([^"]*\)".*/\1/p' | head -1)
    [ -n "$new" ] || herdr_die "pick-selection" "pane split failed: $split_out"

    "$herdr" pane zoom "$new" --on >/dev/null 2>&1

    # exec so quitting the picker closes the split instead of leaving a shell.
    run_out=$("$herdr" pane run "$new" exec "$self" "$mode" "$src" 2>&1)
    case "$run_out" in
    *'"error"'*)
        herdr_die "pick-selection" "pane run failed: $run_out"
        ;;
    esac
    exit 0
fi

# ~/.local_dotfiles/bin is the stow'd machine-local overlay: it holds either the
# generic workflow-preset or a symlink to meta-preset, depending on the machine.
workflow_preset="$HOME/.local_dotfiles/bin/workflow-preset"
if [ ! -x "$workflow_preset" ]; then
    workflow_preset=$(command -v workflow-preset) || herdr_die "pick-selection" \
        "workflow-preset not found (no ~/.local_dotfiles/bin/workflow-preset, none on PATH)"
fi

# Every pick is a clickable hammerspoon:// link inside the picker (see
# workflowPreset.lua), and the open path reads the same URL back out of --json.
# rxpick percent-encodes {match} and {type}, so the template can splice them
# straight into the query string.
url_format='hammerspoon://workflow-preset/open-selection?type={type}&match={match}'

# The picker reads the source pane through the herdr CLI, so a failure there is
# the other likely way this comes up empty -- surface it rather than exiting 0.
# Called as `text=$(read_pane) || exit 1`, never inside a pipeline: a herdr_die
# in here has to be able to take the whole script down, and the exit status of
# anything but the LAST stage of a POSIX pipeline is unreachable.
read_pane() {
    out=$("$herdr" pane read "$pane" --source recent-unwrapped 2>&1)
    case "$out" in
    *'"error"'*)
        herdr_die "pick-selection" "pane read failed for $pane: $out"
        ;;
    esac
    printf '%s\n' "$out"
}

# Run the picker over <text> and print the chosen matches.
#
# rxpick returns 1 for BOTH "the user pressed Esc" and "something actually went
# wrong" (no matches for the configured types; /dev/tty not openable, which is
# what happens if this ever runs somewhere that isn't a real pane). Only the
# real failures write to stderr, so that -- not the exit status -- is what
# separates a quiet cancel from an error worth a notification.
#
# The picker must be the LAST command in the pipeline for $? to be its own; any
# trimming of the result happens afterwards, on the captured string.
run_picker() {
    _text=$1
    shift

    # Spelled out rather than `mktemp -t NAME`: -t means different things to BSD
    # and GNU mktemp, and the GNU one rejects a template with no X's.
    _err=$(mktemp "${TMPDIR:-/tmp}/pick-selection.XXXXXX") || herdr_die "pick-selection" \
        "could not create a temp file for the picker's stderr"

    _out=$(printf '%s\n' "$_text" \
        | "$workflow_preset" pick-selections "$@" --url-format "$url_format" \
            2>"$_err")
    _status=$?
    _msg=$(cat "$_err" 2>/dev/null)
    rm -f "$_err"

    if [ "$_status" -ne 0 ]; then
        [ -n "$_msg" ] && herdr_die "pick-selection" "$_msg"
        exit 0      # plain cancel
    fi

    printf '%s\n' "$_out"
}

case "$mode" in
open)
    # --json keeps the OSC 8 escapes out of the captured text; the URL comes
    # back as a plain field instead. --single-selection makes space confirm, so
    # opening something is one keystroke.
    text=$(read_pane) || exit 1
    pick=$(run_picker "$text" --single-selection --json) || exit 1
    pick=${pick%%
*}                              # first line only
    [ -n "$pick" ] || exit 0

    # python3 is already a hard dependency here: rxpick is a python3 script.
    url=$(printf '%s\n' "$pick" | python3 -c \
        'import json,sys; print(json.loads(sys.stdin.readline()).get("url",""))')
    match=$(printf '%s\n' "$pick" | python3 -c \
        'import json,sys; print(json.loads(sys.stdin.readline()).get("match",""))')

    # Prefer the URL: `open` hands it to Hammerspoon on this Mac, which is the
    # same path a clicked OSC 8 link takes. On a remote (Linux) herdr server
    # there is no `open` and no Hammerspoon, so fall back to acting locally.
    if [ -n "$url" ] && command -v open >/dev/null 2>&1; then
        open "$url"
    else
        [ -n "$match" ] || exit 0
        "$workflow_preset" open-selection "$match" \
            || herdr_die "pick-selection" "open-selection failed for: $match"
    fi
    ;;
copy)
    # --url-format only makes the matches clickable inside the picker; rxpick's
    # printed output is plain text, so what reaches the clipboard is the bare
    # matches, one per line.
    text=$(read_pane) || exit 1
    picks=$(run_picker "$text") || exit 1
    [ -n "$picks" ] || exit 0

    b64=$(printf '%s' "$picks" | base64 | tr -d '\r\n')
    printf '\033]52;c;%s\007' "$b64"
    ;;
*)
    herdr_die "pick-selection" "unknown mode '$mode' (expected open or copy)"
    ;;
esac
