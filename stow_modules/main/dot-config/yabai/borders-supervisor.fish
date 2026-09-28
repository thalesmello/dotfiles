#!/opt/homebrew/bin/fish

set -l yabai_pid $argv[1]
set -g border_pid

if test -z "$yabai_pid"
    exit 64
end

function cleanup --on-event fish_exit
    if test -n "$border_pid"
        kill $border_pid 2>/dev/null
    end
    pkill -x borders 2>/dev/null
end

function terminate --on-signal TERM
    exit 0
end

function interrupt --on-signal INT
    exit 0
end

function hangup --on-signal HUP
    exit 0
end

# Enforce a single JankyBorders instance for this yabai session.
pkill -x borders 2>/dev/null
/opt/homebrew/bin/borders style=round width=6.0 active_color=0xffffffff inactive_color=0x00000000 hidpi=off ax_focus=on &
set border_pid $last_pid

# Keep borders tied to yabai's lifetime.
while kill -0 $yabai_pid 2>/dev/null
    sleep 1
end

exit 0
