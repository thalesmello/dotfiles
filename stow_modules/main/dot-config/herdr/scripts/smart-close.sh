#!/bin/sh
# prefix+backspace:
#   - if the focused pane runs (n)vim -> forward <c-space><bs> so nvim closes its
#     own window (analogous to the smart pane-nav forwarding).
#   - otherwise -> close the focused pane.
#
# Pane identity comes from `herdr pane layout --current`.

info=$(herdr pane layout --current 2>/dev/null | python3 -c '
import sys, json
try:
    l = json.load(sys.stdin)["result"]["layout"]
    print(l.get("focused_pane_id") or "")
    print(l.get("tab_id") or "")
except Exception:
    print("")
    print("")
')
pane=$(printf '%s\n' "$info" | sed -n 1p)

if herdr pane process-info --current 2>/dev/null | grep -Eqw 'nvim|vim'; then
  [ -n "$pane" ] && herdr pane send-keys "$pane" ctrl+space backspace
else
  [ -n "$pane" ] && herdr pane close "$pane"
fi
