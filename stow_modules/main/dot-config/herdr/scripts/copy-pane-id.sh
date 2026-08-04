#!/bin/sh
# Copy the focused pane's id to the clipboard and show a notification.
#
# Uses herdr's native OSC 52 clipboard forwarding instead of pbcopy so it works
# whether the herdr server is local or remote (herdr --remote <ssh-target>): the
# escape is intercepted by herdr and delivered to the attached CLIENT's
# clipboard, whereas pbcopy would set the clipboard on the server's host. This
# only works from a herdr-RENDERED PTY, so the matching keybinding in config.toml
# runs this as a `type = "popup"` command, not a detached `type = "shell"` one.
#
# Pane identity comes from $HERDR_ACTIVE_PANE_ID, which herdr auto-injects into
# custom commands (along with HERDR_SOCKET_PATH and HERDR_BIN_PATH). Note it is
# NOT $HERDR_PANE_ID -- for a popup command that would point at the popup itself
# rather than the pane that was focused when the keybinding fired.

herdr="${HERDR_BIN_PATH:-herdr}"

pane="${HERDR_ACTIVE_PANE_ID}"
[ -n "$pane" ] || exit 1

b64=$(printf '%s' "$pane" | base64 | tr -d '\r\n')
printf '\033]52;c;%s\007' "$b64"

"$herdr" notification show "Copied pane id" --body "$pane"
