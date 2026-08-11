#!/usr/bin/env fish
# prefix+tab: focus the next agent that needs attention -- and when nothing
# needs attention, step forward through the focus history instead (the other
# half of prefix+shift+tab / prefix+ctrl+o; see focus-jumplist.fish).
#
# A fish port of the herdr-attention plugin (https://github.com/milkyskies/
# herdr-attention, MIT), plus that forward-history fallback.
#
# Priority: `blocked` (an agent is waiting on YOU) before `done` (finished work
# to review). The currently-focused agent is skipped, so repeated presses cycle
# through everything: focusing a `done` agent clears its status and you clear
# the `blocked` prompt yourself, so the list shrinks with each press until a
# toast says nothing is left. No cursor state is persisted.
#
# `herdr agent focus` switches workspace, tab and pane in one call, so the jump
# works across the whole session rather than the current tab.

source (status dirname)/herdr-lib.fish

# prefix+shift+tab walks back out of these jumps, and its trail is only recorded
# while the daemon runs -- so make sure it is running before we move the focus.
herdr_ensure_focus_history

set -l bin (herdr_bin)
if test -z "$bin"
    herdr_notify "Attention jump failed" "herdr CLI not found"
    exit 1
end

set -l agents ($bin agent list 2>/dev/null)
if test -z "$agents"
    herdr_notify "Attention jump failed" "could not list agents"
    exit 1
end

# Emits three lines -- count, pane id, label -- or nothing when the queue is
# empty. Sort is blocked-before-done, then pane id for a stable tie-break.
set -l picked (printf '%s\n' $agents | jq -r '
  [ (.result // .).agents[]
    | select(.focused != true)
    | select(.pane_id != null)
    | select(.agent_status == "blocked" or .agent_status == "done") ]
  | sort_by((if .agent_status == "blocked" then 0 else 1 end), .pane_id)
  | select(length > 0)
  | "\(length)\n\(.[0].pane_id)\n\(.[0].agent // "agent") \(.[0].agent_status)"
')

if test (count $picked) -lt 3
    # Nothing is waiting on you, so the key means "forward" instead. With no
    # walk in progress that just reports there is nowhere forward to go.
    set -l jumplist (status dirname)/focus-jumplist.fish
    exec $jumplist forward
end

set -l total $picked[1]
set -l pane $picked[2]
set -l label $picked[3]

if not $bin agent focus $pane >/dev/null 2>&1
    herdr_notify "Attention jump failed" "could not focus $pane"
    exit 1
end

set -l others (math $total - 1)
if test $others -gt 0
    herdr_notify "→ $label (+$others more)"
else
    herdr_notify "→ $label"
end
