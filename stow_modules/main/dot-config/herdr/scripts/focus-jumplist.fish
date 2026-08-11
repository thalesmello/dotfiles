#!/usr/bin/env fish
# Walk the focus history: back to the terminals you came from, forward again.
#
#   focus-jumplist.fish back      prefix+shift+tab, prefix+ctrl+o
#   focus-jumplist.fish forward   prefix+tab, when no agent needs attention
#
# The vim jumplist is the model: back steps deeper into where you have been,
# forward retraces those steps, and doing anything else (focusing some other
# pane, jumping to an agent) ends the walk, so the next back press starts a
# fresh one from wherever you now are.
#
# The trail comes from focus-history-daemon.fish (started here on demand), which
# records every pane focus in order. When a walk starts, the panes reachable
# from the current one are frozen into `walk`:
#
#   walk[1]  the pane the walk started from
#   walk[2]  the pane focused before that, and so on
#
# freezing matters because our own jumps append to the journal too -- recomputing
# the list on every press would make "further back" chase its own tail. The list
# is built by walking the journal backwards, keeping the first (most recent)
# occurrence of each pane and dropping panes that have since been closed, so
# every step lands somewhere different and still open.
#
# `walk-state` holds "index expected_pane journal_len". A press continues the
# walk only when you are still in the pane the last press sent you to and the
# journal has grown by at most the single entry that jump itself produced --
# anything else means the focus moved for another reason and the walk is over.

source (status dirname)/herdr-lib.fish

# Warm-up: a daemon that has just started is still receiving herdr's replay of
# past events, so the end of the journal is not yet "where you just were". The
# replay arrives back-to-back at a few entries per second, so a journal that has
# been quiet for a moment is a journal that has drained -- which is usually true
# a couple of seconds in, rather than the whole REPLAY_MAX_SECONDS. That bound
# is only the fallback for a replay that keeps trickling.
set -l REPLAY_MAX_SECONDS 20
set -l QUIET_SECONDS 2

set -l direction $argv[1]
if test "$direction" != back -a "$direction" != forward
    herdr_notify "Focus jumplist" "usage: focus-jumplist.fish back|forward"
    exit 2
end

herdr_ensure_focus_history

set -l dir (herdr_focus_history_dir)
set -l journal $dir/journal
set -l walk_file $dir/walk
set -l state_file $dir/walk-state

set -l started (cat $dir/started 2>/dev/null | string trim)
if test -z "$started"
    herdr_notify "Focus history starting" "Try again in a few seconds"
    exit 0
end

set -l now (date +%s)
set -l mtime (begin
    stat -f %m $journal
    or stat -c %Y $journal
end 2>/dev/null | string trim)

if test (math $now - $started) -lt $REPLAY_MAX_SECONDS
    and test -n "$mtime"
    and test (math $now - $mtime) -lt $QUIET_SECONDS
    herdr_notify "Focus history warming up" "Try again in a few seconds"
    exit 0
end

set -l current (herdr_current_pane)
if test -z "$current"
    herdr_notify "Focus jumplist failed" "No focused pane"
    exit 1
end

set -l trail (cat $journal 2>/dev/null)
set -l trail_len (count $trail)

# Is the walk from the last press still ours to continue?
set -l index 0
set -l walk
set -l prev (cat $state_file 2>/dev/null | string split ' ')
if test (count $prev) -eq 3
    and test "$prev[2]" = "$current"
    and test (math $trail_len - $prev[3]) -le 1
    set index $prev[1]
    set walk (cat $walk_file 2>/dev/null)
end

set -l bin (herdr_bin); or exit 1
set -l live ($bin pane list 2>/dev/null | jq -r '(.result // .).panes[].pane_id')

if test $index -eq 0
    # No walk in progress.
    if test "$direction" = forward
        herdr_notify "No forward history"
        exit 0
    end

    if test $trail_len -eq 0
        herdr_notify "No focus history yet"
        exit 0
    end

    set walk $current
    for i in (seq $trail_len -1 1)
        set -l pane $trail[$i]
        contains -- $pane $walk; and continue
        contains -- $pane $live; or continue
        set -a walk $pane
    end
    set index 1
    printf '%s\n' $walk >$walk_file
end

# Step, skipping panes closed since the walk was frozen.
set -l target_index $index
while true
    if test "$direction" = back
        set target_index (math $target_index + 1)
        if test $target_index -gt (count $walk)
            herdr_notify "Start of focus history"
            printf '%s %s %s\n' $index $current $trail_len >$state_file
            exit 0
        end
    else
        set target_index (math $target_index - 1)
        if test $target_index -lt 1
            herdr_notify "End of focus history"
            printf '%s %s %s\n' $index $current $trail_len >$state_file
            exit 0
        end
    end
    contains -- $walk[$target_index] $live; and break
end

set -l target $walk[$target_index]

if not herdr_focus_pane $target
    herdr_notify "Focus jumplist failed" "Could not focus $target"
    exit 1
end

printf '%s %s %s\n' $target_index $target $trail_len >$state_file

set -l steps (math $target_index - 1)
if test "$direction" = back
    herdr_notify "← $target" "$steps back"
else if test $steps -eq 0
    herdr_notify "→ $target"
else
    herdr_notify "→ $target" "$steps back"
end
