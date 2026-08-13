#!/bin/sh
# Copy the focused tab's id to the clipboard and show a notification.
#
# Same OSC 52 trick as copy-pane-id.sh: herdr intercepts the escape and delivers
# it to the attached CLIENT's clipboard, so this works over `herdr --remote`
# where pbcopy would set the clipboard on the server's host. It only works from a
# herdr-RENDERED PTY, so the keybinding runs this as `type = "popup"`.
#
# Tab identity comes from $HERDR_ACTIVE_TAB_ID, which herdr auto-injects into
# custom commands alongside HERDR_ACTIVE_WORKSPACE_ID / HERDR_ACTIVE_PANE_ID.

herdr="${HERDR_BIN_PATH:-herdr}"

tab="${HERDR_ACTIVE_TAB_ID}"
[ -n "$tab" ] || exit 1

b64=$(printf '%s' "$tab" | base64 | tr -d '\r\n')
printf '\033]52;c;%s\007' "$b64"

"$herdr" notification show "Copied tab id" --body "$tab"
