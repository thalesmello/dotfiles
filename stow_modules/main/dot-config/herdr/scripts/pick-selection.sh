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
#                                         Captures the pane, then opens a zoomed
#                                         split running the picker over it.
#   pick-selection.sh <mode> <src-pane> [<snapshot>]
#                                         the picker itself, in that split, over
#                                         <snapshot> (or a fresh read without
#                                         one).
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
# ORDER MATTERS: the screen is captured BEFORE the split exists. Splitting
# halves the source pane and reflows it, and the capture zooms that pane to read
# it at full width (see `herdr-preset pane-visible-unwrap`) -- do it the other
# way round and the picker would be matching a screen neither you nor the pane
# ever looked like.
#
# What gets picked over is the VISIBLE pane, not recent scrollback.
# `--source recent-unwrapped` would rejoin soft-wrapped lines but only exists
# for `recent`, so the rejoining is done by pane-visible-unwrap, which is also
# the way to see by hand exactly what the picker matches against.
#
# The pane to pick FROM is $HERDR_ACTIVE_PANE_ID in the launcher (herdr injects
# it into keys.command environments) and is then passed explicitly to the picker
# -- inside the split, $HERDR_PANE_ID is the split itself, not the pane you came
# from.
#
# The launcher is detached and the split closes the moment the picker exits, so
# a message printed to stderr is gone before it can be read: failures are
# reported through herdr_die instead (a notification, or -- when the split still
# has a terminal and the message is too long for a banner -- held on screen
# until a keypress). See herdr-lib.sh, which also explains why the herdr CLI has
# to be resolved rather than assumed on PATH, and why the resolved path is
# passed down into the split.

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

# Neither a detached command nor a fresh pane inherits a login shell's
# environment, so put back
# what the presets below assume: the herdr CLI (herdr-preset shells out to a
# bare `herdr`), the dotfiles bin they call each other through, and homebrew --
# without which `#!/usr/bin/env -S fish` cannot even find fish, and every preset
# here is a fish script.
PATH="$(dirname "$herdr"):$(dirname "$herdr_preset"):/opt/homebrew/bin:$PATH"
export PATH

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
    # Which pane to pick from: HERDR_ACTIVE_PANE_ID, which herdr injects at
    # keypress time and is therefore the pane you were in. Do NOT ask the CLI
    # what is focused instead -- the moment the split below exists, focus is the
    # SPLIT, so any later "what is focused" answer is the picker looking at
    # itself. The live query is only a fallback for a missing variable (running
    # this by hand outside a keybinding).
    src="${HERDR_ACTIVE_PANE_ID}"
    if [ -z "$src" ]; then
        src=$(env -u HERDR_PANE_ID -u HERDR_ACTIVE_PANE_ID "$herdr" pane current 2>/dev/null \
            | python3 -c \
            'import json,sys
try: print(json.load(sys.stdin)["result"]["pane"]["pane_id"])
except Exception: pass')
    fi
    [ -n "$src" ] || herdr_die "pick-selection" \
        "HERDR_ACTIVE_PANE_ID is unset and no pane is focused -- nothing to pick from"

    # One line per launch, so a "that was the wrong pane" can be checked after
    # the fact instead of reproduced blind.
    mkdir -p "$HOME/.local/state/herdr" 2>/dev/null
    printf '%s mode=%s env=%s self=%s used=%s\n' "$(date '+%F %T')" "$mode" \
        "${HERDR_ACTIVE_PANE_ID:-<unset>}" "${HERDR_PANE_ID:-<unset>}" "$src" \
        >> "$HOME/.local/state/herdr/pick-selection.log" 2>/dev/null

    # Capture first, split second (see the note at the top).
    text=$(read_pane "$src") || exit 1
    snap=$(mktemp "${TMPDIR:-/tmp}/pick-selection-snap.XXXXXX") || herdr_die \
        "pick-selection" "could not create a temp file for the pane snapshot"
    printf '%s\n' "$text" > "$snap"

    # Absolute path: `pane run` hands the command to the split's shell, which
    # has its own cwd (and would re-expand a leading ~).
    self=$(cd -P "$(dirname "$0")" 2>/dev/null && pwd)/$(basename "$0")

    split_out=$("$herdr" pane split "$src" --direction right --focus \
        --env "HERDR_BIN_PATH=$herdr" 2>&1)
    new=$(printf '%s' "$split_out" \
        | sed -n 's/.*"pane_id":"\([^"]*\)".*/\1/p' | head -1)
    [ -n "$new" ] || { rm -f "$snap"; herdr_die "pick-selection" \
        "pane split failed: $split_out"; }

    "$herdr" pane zoom "$new" --on >/dev/null 2>&1

    # exec so quitting the picker closes the split instead of leaving a shell.
    if ! "$herdr" pane run "$new" exec "$self" "$mode" "$src" "$snap" >/dev/null 2>&1; then
        rm -f "$snap"
        herdr_die "pick-selection" "pane run failed in $new"
    fi
    exit 0
fi

# When this split closes, herdr hands focus to whichever pane it likes; put it
# back on the pane the picks came from. Unless the action moved focus somewhere
# deliberate -- `open` on a file lands nvim in its own split, and stealing that
# back would be worse than not focusing at all -- which is what refocus=0 marks.
refocus=1
focused_pane() {
    "$herdr" pane layout --pane "$pane" 2>/dev/null | python3 -c \
        'import json,sys
try: print(json.load(sys.stdin)["result"]["layout"].get("focused_pane_id",""))
except Exception: pass'
}
focus_source() {
    [ "$refocus" = 1 ] || return 0
    "$herdr" agent focus "$pane" >/dev/null 2>&1
}
trap focus_source EXIT

# ~/.local_dotfiles/bin is the stow'd machine-local overlay: it holds either the
# generic workflow-preset or a symlink to meta-preset, depending on the machine.
workflow_preset="$HOME/.local_dotfiles/bin/workflow-preset"
if [ ! -x "$workflow_preset" ]; then
    workflow_preset=$(command -v workflow-preset) || herdr_die "pick-selection" \
        "workflow-preset not found (no ~/.local_dotfiles/bin/workflow-preset, none on PATH)"
fi

# Picks are clickable inside the picker: pick-selections gives each type a URL
# (a direct link where the type has one, otherwise a hammerspoon:// bounce --
# see workflowPreset.lua). That is purely for the mouse; both modes below act
# on the match text itself.

# The launcher left the screen it captured here. Falling back to a live read
# keeps the picker runnable by hand (`pick-selection.sh open <pane>`).
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
        | "$workflow_preset" pick-selections "$@" 2>"$_err")
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

    # If the action parked focus on some other pane (nvim in a fresh split),
    # leave it there; anything else (a url in Chrome) leaves herdr's focus on
    # this split, which is about to close.
    now=$(focused_pane)
    if [ -n "$now" ] && [ -n "$HERDR_PANE_ID" ] && [ "$now" != "$HERDR_PANE_ID" ]; then
        refocus=0
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
