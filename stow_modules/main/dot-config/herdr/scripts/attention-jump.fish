#!/usr/bin/env fish
# prefix+tab: focus the next agent that needs attention -- and when nothing
# needs attention, step forward through the focus history instead (the other
# half of prefix+shift+tab / prefix+ctrl+o; see focus-jumplist.fish).
#
# A fish port of the herdr-attention plugin (https://github.com/milkyskies/
# herdr-attention, MIT), plus that forward-history fallback.
#
# Priority matches the Agents panel's "smart priority" order (see VIEW_SORT in
# agent-handler.py): snoozed agents (`herdr_snooze`) are skipped, pinned chats
# (`um_pin`) sort first, `blocked` (an agent is waiting on YOU) comes before
# `done` (finished work to review), most recent state change (`state_change_seq`
# descending) comes first within each status, and the `agent list` workspace /
# tab / pane order breaks ties. If the focused agent is itself in the queue
# (e.g. an unresolved `blocked` prompt), repeated presses rotate past it so
# `prefix+tab` walks down the full smart-priority list without ping-ponging.
#
# `herdr agent focus` switches workspace, tab and pane in one call, so the jump
# works across the whole session rather than the current tab.

source (status dirname)/herdr-lib.fish

# prefix+shift+tab walks back out of these jumps, and its trail is only recorded
# while the daemon runs -- so make sure it is running before we move the focus.
herdr_ensure_focus_history (herdr_current_pane)

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
# empty. Order matches agent-handler.py's "smart priority" view sort:
# pinned (`um_pin`), status (`blocked` before `done`), `state_change_seq`
# descending, then `agent list` order (workspace / tab / pane). When the
# focused agent is in the queue, rotate past it so repeated presses step
# through every blocked/done agent in sidebar order.
set -l picked (printf '%s\n' $agents | jq -r '
  [ (.result // .).agents
    | to_entries[]
    | select(.value.pane_id != null)
    | select((.value.tokens.herdr_snooze // "") == "")
    | select(.value.agent_status == "blocked" or .value.agent_status == "done") ]
  | sort_by(
      (if (.value.tokens.um_pin // "") != "" then 0 else 1 end),
      (if .value.agent_status == "blocked" then 0 else 1 end),
      -(.value.state_change_seq // 0),
      .key
    )
  | map(.value)
  | (map(.focused == true) | index(true)) as $idx
  | if $idx != null then .[($idx + 1):] + .[:$idx] else . end
  | map(select(.focused != true))
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

herdr_focus_history_record $pane

set -l others (math $total - 1)
if test $others -gt 0
    herdr_notify "→ $label (+$others more)"
else
    herdr_notify "→ $label"
end
