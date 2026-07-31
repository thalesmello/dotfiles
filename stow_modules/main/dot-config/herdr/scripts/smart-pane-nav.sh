#!/bin/sh
# Smart pane navigation for prefix+ctrl+{h,j,k,l}.
#
# Default: focus the herdr pane in the given direction (same as prefix+h/j/k/l).
# Exception: when the focused pane is running (n)vim AND herdr cannot meaningfully
# navigate -- the pane is zoomed, or it is the only pane in the tab -- forward
# ctrl+<key> to the pane so nvim's own window navigation handles it (analogous to
# vim-tmux-navigator / smart-splits.nvim).
#
# The (n)vim gate matters: ctrl+h/j/k/l sent to a shell would be
# backspace/newline/kill-line/clear. When in doubt we focus, never forward.
#
# Pane identity comes from $HERDR_ACTIVE_PANE_ID, which herdr injects into every
# keys.command environment (the same var the clear-screen binding uses), so we
# read it directly instead of parsing it back out of the layout.
# Set HERDR_SMARTNAV_DEBUG=1 to print the decision instead of acting.

dir="$1"      # left | down | up | right
letter="$2"   # h | j | k | l

herdr="${HERDR_BIN_PATH:-herdr}"

# Focused pane id is injected by herdr; no CLI call needed for it.
pane="${HERDR_ACTIVE_PANE_ID:-}"

# layout is still required for no_room: "1" if zoomed or a single pane else "0".
# jq starts far faster than python3, so parsing stays cheap.
no_room=$("$herdr" pane layout --current 2>/dev/null | jq -r '
  (.result // .).layout as $s
  | if ($s.zoomed == true) or (($s.panes // []) | length) <= 1 then "1" else "0" end
' 2>/dev/null)

# The (n)vim gate only matters when herdr has no room to navigate (zoomed or a
# single pane). In the common multi-pane case we skip the extra process-info
# call entirely and just focus. is_vim is computed lazily via check_vim().
check_vim() {
  "$herdr" pane process-info --current 2>/dev/null | grep -Eqw 'nvim|vim'
}

if [ "${HERDR_SMARTNAV_DEBUG:-}" = "1" ]; then
  is_vim=no
  check_vim && is_vim=yes
  printf 'dir=%s letter=%s pane=%s no_room=%s is_vim=%s -> %s\n' \
    "$dir" "$letter" "$pane" "$no_room" "$is_vim" \
    "$([ "$no_room" = 1 ] && [ "$is_vim" = yes ] && [ -n "$pane" ] && echo forward || echo focus)"
  exit 0
fi

if [ "$no_room" = "1" ] && [ -n "$pane" ] && check_vim; then
  "$herdr" pane send-keys "$pane" ctrl+space "ctrl+$letter"
else
  "$herdr" pane focus --direction "$dir" --current 2>/dev/null
fi
