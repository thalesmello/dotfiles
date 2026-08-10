#!/bin/sh
# Pick something out of the focused pane's recent output and act on it.
#
#   pick-selection.sh open   -> pick exactly one match and hand it, with the
#                               type rxpick tagged it with, to
#                               `workflow-preset open-selection-type` (file in
#                               nvim, url in Chrome, plus the work-specific id
#                               shapes on a Meta box)
#   pick-selection.sh copy   -> copy every pick to the clipboard as plain text
#
# Two roles in one file, like run-command.sh:
#
#   pick-selection.sh <mode>              launcher -- what prefix+o / prefix+y
#                                         run as `type = "shell"` commands.
#                                         Snapshots the pane, makes a zoomed
#                                         split and starts the picker in it,
#                                         then exits.
#   pick-selection.sh <mode> <src-pane> [<snapshot>]
#                                         the picker itself, running in that
#                                         split, over <snapshot> (or a fresh
#                                         read of <src-pane> without one).
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
# What gets picked over is the VISIBLE pane -- what you were looking at when you
# hit the key -- not recent scrollback. `--source recent-unwrapped` would rejoin
# soft-wrapped lines for us but only exists for `recent`, so the rejoining is
# done by `herdr-preset pane-visible-unwrap`, which is also the way to see by
# hand exactly what the picker matches against.
#
# The snapshot is taken in the launcher, BEFORE the split, because splitting
# resizes the source pane (104 columns -> 52 here) and its content reflows: read
# afterwards, the picker would show a differently wrapped screen than the one you
# pressed the key on, and the wrap width would have changed under it too.
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

# Same PATH problem as the herdr CLI (see herdr-lib.sh): a detached command
# inherits the server's environment, which may not have the dotfiles bin on it.
# Fall back to the copy in the checkout this script is stowed from -- `cd -P` so
# the `..` climbing walks the real tree rather than the ~/.config symlink.
herdr_preset=$(command -v herdr-preset 2>/dev/null)
if [ -z "$herdr_preset" ]; then
    herdr_preset=$(cd -P "$(dirname "$0")/../../../../../bin" 2>/dev/null && pwd)/herdr-preset
fi
[ -x "$herdr_preset" ] || herdr_die "pick-selection" \
    "herdr-preset not found (not on PATH, and none beside this script's checkout)"

mode="${1:-open}"
pane="${2:-}"
snapshot="${3:-}"

# Read the visible screen of <pane>, with words the pane broke across rows
# joined back up -- see `herdr-preset pane-visible-unwrap`, which is where that
# logic lives (and which can be run by hand to see exactly what the picker
# matches against).
#
# Called as `text=$(read_pane "$p") || exit 1`, never inside a pipeline: a
# herdr_die in here has to be able to take the whole script down, and the exit
# status of anything but the LAST stage of a POSIX pipeline is unreachable.
read_pane() {
    out=$("$herdr_preset" pane-visible-unwrap "$1" 2>&1) || herdr_die \
        "pick-selection" "pane-visible-unwrap failed for $1: $out"
    printf '%s\n' "$out"
}

if [ -z "$pane" ]; then
    src="${HERDR_ACTIVE_PANE_ID}"
    [ -n "$src" ] || herdr_die "pick-selection" \
        "HERDR_ACTIVE_PANE_ID is unset -- no pane to pick from"

    # Snapshot the screen as it is NOW: the split below resizes the source pane
    # and reflows it.
    text=$(read_pane "$src") || exit 1
    snap=$(mktemp "${TMPDIR:-/tmp}/pick-selection-snap.XXXXXX") || herdr_die \
        "pick-selection" "could not create a temp file for the pane snapshot"
    printf '%s\n' "$text" > "$snap"

    # Absolute path: `pane run` hands the command to the split's shell, which
    # has its own cwd (and would re-expand a leading ~).
    self=$(cd "$(dirname "$0")" 2>/dev/null && pwd)/$(basename "$0")

    split_out=$("$herdr" pane split "$src" --direction right --focus \
        --env "HERDR_BIN_PATH=$herdr" 2>&1)
    new=$(printf '%s' "$split_out" \
        | sed -n 's/.*"pane_id":"\([^"]*\)".*/\1/p' | head -1)
    [ -n "$new" ] || { rm -f "$snap"; herdr_die "pick-selection" \
        "pane split failed: $split_out"; }

    "$herdr" pane zoom "$new" --on >/dev/null 2>&1

    # exec so quitting the picker closes the split instead of leaving a shell.
    run_out=$("$herdr" pane run "$new" exec "$self" "$mode" "$src" "$snap" 2>&1)
    case "$run_out" in
    *'"error"'*)
        rm -f "$snap"
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
# workflowPreset.lua). That is purely for the mouse -- both modes below act on
# the match text itself. rxpick percent-encodes {match} and {type}, so the
# template can splice them straight into the query string.
url_format='hammerspoon://workflow-preset/open-selection?type={type}&match={match}'

# The launcher left the screen it snapshotted here. Falling back to a live read
# keeps the picker runnable by hand (`pick-selection.sh open <pane>`), where
# nothing has resized the pane.
if [ -n "$snapshot" ] && [ -f "$snapshot" ]; then
    text=$(cat "$snapshot")
    rm -f "$snapshot"
else
    text=$(read_pane "$pane") || exit 1
fi

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
        | "$workflow_preset" pick-selections "$@" \
            --default-url-format "$url_format" \
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
    # --json keeps the OSC 8 escapes the URL template adds out of the captured
    # text, leaving the bare match in a field. --single-selection makes space
    # confirm, so opening something is one keystroke.
    pick=$(run_picker "$text" --single-selection --json) || exit 1
    pick=${pick%%
*}                              # first line only
    [ -n "$pick" ] || exit 0

    # python3 is already a hard dependency here: rxpick is a python3 script.
    # Take the type as well as the match: the picker has already named this
    # thing, so there is no reason to make workflow-preset work it out again.
    fields=$(printf '%s\n' "$pick" | python3 -c \
        'import json,sys; o=json.loads(sys.stdin.readline()); print(o.get("type","")); print(o.get("match",""))')
    pick_type=${fields%%
*}                              # first line
    match=${fields#*
}                                   # everything after it
    [ -n "$match" ] || exit 0

    # Act directly rather than going out through the pick's hammerspoon:// URL:
    # those exist for clicking with the mouse, and routing a keyboard pick
    # through the URL would need `open` (and Hammerspoon) on whatever host the
    # herdr server runs on.
    #
    # open-selection-type runs the action for an already-named match.
    # open-selection is the fallback for an untyped pick (rxpick only omits
    # the type in unnamed mode, which pick-selections never uses) and re-derives
    # the name from the text.
    if [ -n "$pick_type" ]; then
        "$workflow_preset" open-selection-type -- "$pick_type" "$match" \
            || herdr_die "pick-selection" \
                "open-selection-type failed for $pick_type: $match"
    else
        "$workflow_preset" open-selection "$match" \
            || herdr_die "pick-selection" "open-selection failed for: $match"
    fi
    ;;
copy)
    # The URL template only makes the matches clickable inside the picker;
    # rxpick's printed output is plain text, so what reaches the clipboard is
    # the bare matches, one per line.
    picks=$(run_picker "$text") || exit 1
    [ -n "$picks" ] || exit 0

    b64=$(printf '%s' "$picks" | base64 | tr -d '\r\n')
    printf '\033]52;c;%s\007' "$b64"
    ;;
*)
    herdr_die "pick-selection" "unknown mode '$mode' (expected open or copy)"
    ;;
esac
