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
# Pane identity comes from `herdr pane layout --current` (focused_pane_id), so it
# does not depend on $HERDR_PANE_ID being injected into the command environment.
# Set HERDR_SMARTNAV_DEBUG=1 to print the decision instead of acting.

dir="$1"      # left | down | up | right
letter="$2"   # h | j | k | l

herdr="${HERDR_BIN_PATH:-herdr}"

layout=$("$herdr" pane layout --current 2>/dev/null)

# Parse: line 1 = focused pane id, line 2 = "1" if zoomed or single pane else "0".
parsed=$(printf '%s' "$layout" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    s = d.get("result", d).get("layout", {})
    print(s.get("focused_pane_id") or "")
    print("1" if (bool(s.get("zoomed")) or len(s.get("panes") or []) <= 1) else "0")
except Exception:
    print("")
    print("0")
')
pane=$(printf '%s\n' "$parsed" | sed -n 1p)
no_room=$(printf '%s\n' "$parsed" | sed -n 2p)

is_vim=no
if "$herdr" pane process-info --current 2>/dev/null | grep -Eqw 'nvim|vim'; then
  is_vim=yes
fi

if [ "${HERDR_SMARTNAV_DEBUG:-}" = "1" ]; then
  printf 'dir=%s letter=%s pane=%s no_room=%s is_vim=%s -> %s\n' \
    "$dir" "$letter" "$pane" "$no_room" "$is_vim" \
    "$([ "$no_room" = 1 ] && [ "$is_vim" = yes ] && [ -n "$pane" ] && echo forward || echo focus)"
  exit 0
fi

if [ "$no_room" = "1" ] && [ "$is_vim" = "yes" ] && [ -n "$pane" ]; then
  "$herdr" pane send-keys "$pane" ctrl+space "ctrl+$letter"
else
  "$herdr" pane focus --direction "$dir" --current 2>/dev/null
fi
