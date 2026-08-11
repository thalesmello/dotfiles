#!/usr/bin/env fish
# Focus-history daemon: record every pane that gets focused, in order.
#
# herdr has no "last pane" API -- `pane list` says which pane is focused now,
# never which one was focused before -- so focus-jumplist.fish needs a trail
# kept by something that is watching. That is this: one long-lived connection to
# the API socket subscribed to pane.focused, appending each newly focused pane
# id to
#
#   ${XDG_STATE_HOME:-~/.local/state}/herdr/focus-history/journal
#
# It is started lazily by focus-jumplist.fish / attention-jump.fish (see
# herdr_ensure_focus_history), so there is nothing to add to a login shell.
#
# Three details worth knowing:
#
# * On subscribe, herdr replays a backlog of past pane.focused events before it
#   starts streaming live ones, and it does so at a leisurely few events per
#   second. So a freshly started daemon spends ~15s writing OLD history into the
#   journal, during which the tail is not "where you just were".
#   focus-jumplist.fish will not jump until the journal goes quiet.
#
# * The subscription must be held open by a writer that NEVER WRITES. nc keeps
#   the connection only as long as its stdin is open, but a second request on a
#   subscribed connection -- even a ping -- makes herdr stop delivering events
#   on it, silently: the socket stays open, the stream just stops. So stdin is a
#   fifo held open by an idle `sleep`, and the daemon kills that sleep once nc
#   is gone (a keepalive here would kill the daemon roughly every minute).
#
# * The reader is a second copy of this script (`--record`) rather than a
#   `while read` block at the end of the pipeline: fish does not start a
#   pipeline until its last stage can be run, and a builtin block as the last
#   stage of a pipeline fed by a never-ending producer simply never gets going.
#   An external command as the tail keeps the whole thing streaming.

source (status dirname)/herdr-lib.fish

set -g dir (herdr_focus_history_dir)
set -g journal $dir/journal
set -g lock $dir/daemon.lock

# Journal size: JOURNAL_MAX lines is a few sessions' worth of navigation; when
# it is exceeded the file is cut back to JOURNAL_KEEP, which is still far deeper
# than anyone walks back with repeated presses.
set -g JOURNAL_MAX 2000
set -g JOURNAL_KEEP 500

if test "$argv[1]" = --record
    while read -l line
        string match -q '*"event":"pane_focused"*' -- $line; or continue
        set -l pane (string match -rg '"pane_id":"([^"]+)"' -- $line)
        test -n "$pane"; or continue

        # Consecutive duplicates carry no navigation: herdr re-emits
        # pane.focused for things like re-attaching to the pane you are in.
        set -l last (tail -n 1 $journal 2>/dev/null)
        test "$pane" = "$last"; and continue

        echo $pane >>$journal

        set -l lines (wc -l <$journal | string trim)
        if test "$lines" -gt $JOURNAL_MAX
            tail -n $JOURNAL_KEEP $journal >$journal.tmp
            and mv $journal.tmp $journal
        end
    end
    exit 0
end

# mkdir is the atomic bit: two keypresses racing to start a daemon means exactly
# one of them creates the lock, and the loser exits.
if not mkdir $lock 2>/dev/null
    set -l pid (cat $lock/pid 2>/dev/null)
    if test -n "$pid"; and kill -0 $pid 2>/dev/null
        exit 0
    end
    # Lock left behind by a daemon that died (server restart, reboot).
    rm -rf $lock
    mkdir $lock 2>/dev/null; or exit 0
end

echo $fish_pid >$lock/pid

set -g keeper ""

function __herdr_focus_history_cleanup --on-event fish_exit
    test -n "$keeper"; and kill $keeper 2>/dev/null
    rm -rf $lock
end

set -l sock (herdr_socket)
if test -z "$sock"
    herdr_notify "Focus history: no herdr socket"
    exit 1
end

date +%s >$dir/started

# Every start costs a warm-up, so leave a trail: if these lines pile up, the
# subscription is dying for some reason and this file says how often.
date '+%Y-%m-%d %H:%M:%S start' >>$dir/restarts.log

set -l subscribe '{"id":"focus-history","method":"events.subscribe","params":{"subscriptions":[{"type":"pane.focused"}]}}'
set -l self (status filename)
set -l fifo $dir/subscribe.fifo

rm -f $fifo
mkfifo $fifo; or exit 1

# The idle sleep is what keeps nc's stdin open, and writing nothing is what
# keeps the subscription alive (see the note at the top). It is not part of the
# pipeline, so fish does not wait on it -- the daemon exits the moment nc does,
# which is what makes a dead subscription turn into a restart on the next
# keypress rather than a daemon that is up but deaf.
#
# Both fifo writers go through `sh -c` because fish opens a job's redirections
# in the parent, even for a background job: `sleep ... >$fifo &` would hang the
# daemon in open() waiting for the reader it is about to start. Handing the
# redirection to sh means sh does the blocking open, and it unblocks when nc
# opens the read end below. `exec` keeps the sleep on sh's pid so $keeper is the
# process we later kill.
sh -c "exec sleep 2147483647 >$fifo" &
set keeper $last_pid

sh -c "printf '%s\n' '$subscribe' >$fifo" &

nc -U $sock <$fifo | $self --record

kill $keeper 2>/dev/null
rm -f $fifo
