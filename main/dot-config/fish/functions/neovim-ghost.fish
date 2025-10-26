function neovim-ghost
    set preset $argv[1]
    set -e argv[1]

    switch "$preset"
    case "focus"
        display-message "Focus GHOST"
        yabai-preset focus-pid "$(cat "$TMPDIR/nvim_ghost.pid")"
    case "start"
        display-message "Start GHOST"
        env NVIM_GHOST_ENABLE=1 NVIM_LITE_MODE=1 neovide --frame buttonless --title-hidden -- --listen "$TMPDIR/nvim_ghost.socket" &
        echo "$last_pid" > "$TMPDIR/nvim_ghost.pid"
        wait
        rm "$TMPDIR/nvim_ghost.pid"
    case "trigger"
        if pgrep -q -F "$TMPDIR/nvim_ghost.pid"
            neovim-ghost focus
        else
            neovim-ghost start
        end;
    case "remote-tab-wait-with-focus"
        neovim-ghost trigger
        nvr --nostart --servername "$TMPDIR/nvim_ghost.socket" --remote-tab-wait +"set bufhidden=delete" $argv
        yabai-preset minimize-pid "$(cat "$TMPDIR/nvim_ghost.pid")"

    case "*"
        echo "invalid preset $preset" >&2
    end
end
