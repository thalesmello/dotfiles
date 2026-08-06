#!/bin/sh
# Pick something out of the focused pane's recent output and act on it.
#
#   pick-selection.sh open   -> open the FIRST pick (file in nvim, url in Chrome,
#                               plus the work-specific id shapes on a Meta box)
#   pick-selection.sh copy   -> copy ALL picks to the clipboard
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

picks=$("$herdr" pane read "$pane" --source recent-unwrapped 2>/dev/null \
    | "$workflow_preset" pick-selections) || exit 0
[ -n "$picks" ] || exit 0

case "$mode" in
open)
    first=$(printf '%s\n' "$picks" | head -1)
    [ -n "$first" ] || exit 0
    "$workflow_preset" open-selection "$first"
    ;;
copy)
    b64=$(printf '%s' "$picks" | base64 | tr -d '\r\n')
    printf '\033]52;c;%s\007' "$b64"
    ;;
*)
    echo "usage: pick-selection.sh [open|copy]" >&2
    exit 2
    ;;
esac
