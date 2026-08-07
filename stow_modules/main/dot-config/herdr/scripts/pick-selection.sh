#!/bin/sh
# Pick something out of the focused pane's recent output and act on it.
#
#   pick-selection.sh open   -> pick exactly one match and open it (file in nvim,
#                               url in Chrome, plus the work-specific id shapes
#                               on a Meta box), by way of Hammerspoon
#   pick-selection.sh copy   -> copy every pick to the clipboard as plain text
#
# The picker (`workflow-preset pick-selections`, a wrapper around rxpick) is a
# curses UI, so the matching keybindings in config.toml run this as a full-screen
# `type = "popup"` command -- a herdr-RENDERED PTY. That is also what makes the
# copy mode work over `herdr --remote`: herdr intercepts the OSC 52 escape on the
# popup PTY and forwards the payload to the ATTACHED CLIENT's clipboard, whereas
# pbcopy would write to the herdr *server* host's clipboard. See
# copy-last-output.sh for the longer version of that story.
#
# --source recent-unwrapped is what gets fed to the picker: recent scrollback
# with soft-wrapped lines rejoined, so a path or url that the pane broke across
# two rows still matches as one token.
#
# Pane identity comes from $HERDR_ACTIVE_PANE_ID, which herdr auto-injects into
# custom commands. Note it is NOT $HERDR_PANE_ID -- for a popup command that
# would point at the popup itself rather than the pane that was focused when the
# keybinding fired.

herdr="${HERDR_BIN_PATH:-herdr}"

mode="${1:-open}"

pane="${HERDR_ACTIVE_PANE_ID}"
[ -n "$pane" ] || exit 1

# ~/.local_dotfiles/bin is the stow'd machine-local overlay: it holds either the
# generic workflow-preset or a symlink to meta-preset, depending on the machine.
workflow_preset="$HOME/.local_dotfiles/bin/workflow-preset"
[ -x "$workflow_preset" ] || workflow_preset=$(command -v workflow-preset) || exit 1

# Every pick is a clickable hammerspoon:// link inside the picker (see
# workflowPreset.lua), and the open path reads the same URL back out of --json.
# rxpick percent-encodes {match} and {type}, so the template can splice them
# straight into the query string.
url_format='hammerspoon://workflow-preset/open-selection?type={type}&match={match}'

case "$mode" in
open)
    # --json keeps the OSC 8 escapes out of the captured text; the URL comes
    # back as a plain field instead. --single-selection makes space confirm, so
    # opening something is one keystroke.
    pick=$("$herdr" pane read "$pane" --source recent-unwrapped 2>/dev/null \
        | "$workflow_preset" pick-selections --single-selection --json \
            --url-format "$url_format" | head -1) || exit 0
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
        "$workflow_preset" open-selection "$match"
    fi
    ;;
copy)
    # --url-format only makes the matches clickable inside the picker; rxpick's
    # printed output is plain text, so what reaches the clipboard is the bare
    # matches, one per line.
    picks=$("$herdr" pane read "$pane" --source recent-unwrapped 2>/dev/null \
        | "$workflow_preset" pick-selections --url-format "$url_format") || exit 0
    [ -n "$picks" ] || exit 0

    b64=$(printf '%s' "$picks" | base64 | tr -d '\r\n')
    printf '\033]52;c;%s\007' "$b64"
    ;;
*)
    echo "usage: pick-selection.sh [open|copy]" >&2
    exit 2
    ;;
esac
