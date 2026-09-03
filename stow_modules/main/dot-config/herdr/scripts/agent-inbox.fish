#!/usr/bin/env fish
# Inbox operations on the focused agent -- the keybinding half of
# agent-inbox-daemon.py.
#
#   agent-inbox.fish settle             prefix+m
#   agent-inbox.fish unread             prefix+u
#   agent-inbox.fish clear
#   agent-inbox.fish settle-workspace   prefix+alt+m
#   agent-inbox.fish retitle
#   agent-inbox.fish restart
#
# This is upstream's actions.py (github.com/douglascorrea/herdr-agent-inbox,
# MIT) rewritten as a key script: no plugin means no
# HERDR_PLUGIN_CONTEXT_JSON, so the pane comes from HERDR_ACTIVE_PANE_ID (which
# herdr injects into every keys.command environment) and the workspace from a
# `pane get` on it.
#
# Everything goes to the daemon's control socket, which answers one line of
# JSON per connection and closes -- so `nc -U` is a complete client. The daemon
# is started on demand the same way focus-history-daemon.fish is: a detached
# `type = "shell"` binding has no terminal, so the notification below is the
# only thing that reaches the screen when this fails.

source (status dirname)/herdr-lib.fish

set -l op $argv[1]
if test -z "$op"
    echo "usage: agent-inbox.fish <settle|unread|clear|settle-workspace|retitle|restart>" >&2
    exit 2
end

if test "$op" = restart
    herdr_restart_agent_inbox
    herdr_notify "agent inbox restarted"
    exit 0
end

herdr_ensure_agent_inbox

set -l pane (herdr_current_pane)
if test -z "$pane"
    herdr_notify "agent inbox: $op failed" "no focused pane"
    exit 1
end

# settle-workspace is the only op that needs more than the pane: the daemon
# filters `agent.list` by workspace, and only herdr knows which one this pane
# is in.
set -l workspace ""
if test "$op" = settle-workspace
    set -l bin (herdr_bin)
    if test -n "$bin"
        set workspace ($bin pane get $pane 2>/dev/null |
            jq -r '((.result // .).pane // (.result // .)).workspace_id // empty')
    end
    if test -z "$workspace"
        herdr_notify "agent inbox: settle-workspace failed" "no workspace for $pane"
        exit 1
    end
end

# Two attempts: the first can lose a race with a daemon that is still binding
# its control socket after the ensure above started it.
set -l resp ""
for attempt in 1 2
    set resp (herdr_inbox_send $op $pane $workspace)
    test -n "$resp"; and break
    sleep 0.8
end

if test -z "$resp"
    herdr_notify "agent inbox: daemon not reachable" \
        "see "(herdr_agent_inbox_dir)"/daemon.log"
    exit 1
end

if test (printf '%s' $resp | jq -r '.ok // false') != true
    herdr_notify "agent inbox: $op failed" (printf '%s' $resp | jq -r '.error // ""')
    exit 1
end

set -l label (printf '%s' $resp | jq -r '.title // ""')
switch "$op"
case settle
    herdr_notify "⚑ settled" $label
case unread
    herdr_notify "● marked unread" $label
case settle-workspace
    herdr_notify "⚑ settled workspace" $label
case retitle
    herdr_notify "regenerating title" $label
end
exit 0
