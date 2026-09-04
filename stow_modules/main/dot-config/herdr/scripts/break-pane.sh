#!/usr/bin/env bash
# prefix+shift+m: break the focused pane out of its split (tmux parity:
# `break-pane`), asking for the new name first.
#   - pane shares its tab with other panes -> move it to a new tab of the same
#     workspace, prompting for the tab name, prefilled with the pane's name.
#   - pane is already alone in its tab -> a new tab would look identical to what
#     you already have, so this is really the tab moving out: move it to a new
#     workspace instead, prompting for the workspace name prefilled with the
#     tab's name (the workspace's single tab gets the same name).
#
# The prefill is editable: the prompt starts with it typed in, so Enter keeps it
# and backspace whittles it down. A pane has no name until `pane rename`, so it
# falls back to what the sidebar shows for it -- its title, then its terminal
# title.
#
# herdr has no native action for either move, so this drives `pane move`. In
# both destinations --label names the thing being created (the new tab, or the
# new workspace); --tab-label names the tab inside a new workspace.
#
# Bound as a `type = "popup"` command so the prompt runs in a herdr-rendered PTY
# where interactive input works -- a detached `type = "shell"` command has no
# terminal. The popup is not a real pane, so the pane to move is
# HERDR_ACTIVE_PANE_ID (the pane focused when the binding fired), not whatever
# `pane layout --current` reports from in here.
#
# Esc cancels and moves nothing. Emptying the prompt and pressing Enter keeps
# herdr's generated name.

. "$(cd "$(dirname "$0")" && pwd)/prompt-lib.sh"

herdr="${HERDR_BIN_PATH:-herdr}"

pane="$HERDR_ACTIVE_PANE_ID"
[ -n "$pane" ] || { printf 'no focused pane\n'; sleep 1; exit 1; }

# Pane name (first of label/title/terminal title) + its tab, in one call.
info=$("$herdr" pane get "$pane" 2>/dev/null | python3 -c '
import sys, json, re
try:
    p = json.load(sys.stdin)["result"]["pane"]
    name = p.get("label") or p.get("title") or p.get("terminal_title_stripped") or ""
    # terminal_title_stripped keeps the agent state glyph ("* ", "◑ "); it is
    # decoration, not part of a name you would type.
    print(re.sub(r"^[^\x00-\x7f]+\s*", "", name))
    print(p.get("tab_id") or "")
except Exception:
    print("")
    print("")
')
pane_name=$(printf '%s\n' "$info" | sed -n 1p)
tab=$(printf '%s\n' "$info" | sed -n 2p)

# How many panes share that tab -- decides new tab vs new workspace.
count=$("$herdr" pane layout --pane "$pane" 2>/dev/null | python3 -c '
import sys, json
try:
    print(len(json.load(sys.stdin)["result"]["layout"].get("panes") or []))
except Exception:
    print(0)
')

if [ "$count" -gt 1 ]; then
  prompt='New tab name: '
  name=$pane_name
else
  prompt='New workspace name: '
  name=$("$herdr" tab get "$tab" 2>/dev/null | python3 -c '
import sys, json
try:
    print(json.load(sys.stdin)["result"]["tab"].get("label") or "")
except Exception:
    print("")
')
fi

# The name comes from the shared popup prompt (prompt-lib.sh) -- this script is
# where that reader started, so the behaviour is unchanged: raw-mode line
# editing (backspace, ctrl+w, opt+backspace, ctrl+u), Esc to cancel, and now
# bracketed paste. Emptying the prompt and pressing Enter keeps herdr's
# generated name.
prompt_line "$prompt" "$name" || exit 0   # Esc -> leave without moving anything
name=$PROMPT_LINE

if [ "$count" -gt 1 ]; then
  set -- --new-tab
  [ -n "$name" ] && set -- "$@" --label "$name"
else
  set -- --new-workspace
  [ -n "$name" ] && set -- "$@" --label "$name" --tab-label "$name"
fi

"$herdr" pane move "$pane" "$@" --focus
