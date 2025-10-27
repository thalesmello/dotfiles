function neovim-ghost
    set preset $argv[1]
    set -e argv[1]

    switch "$preset"
    case "is-alive"
        pgrep -q -F "$TMPDIR/nvim_ghost.pid"
        return $status
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
        if neovim-ghost is-alive
            neovim-ghost focus
        else
            neovim-ghost start
        end;
    case "edit"
        set skip_focus 0
        if not neovim-ghost is-alive
            neovim-ghost start
            set skip_focus 1
        end

        nvr --nostart --servername "$TMPDIR/nvim_ghost.socket" --remote-tab-wait +"set bufhidden=delete" $argv &

        if test "$skip_focus" != 1
            neovim-ghost focus
        end

        wait

        yabai-preset minimize-pid "$(cat "$TMPDIR/nvim_ghost.pid")"

    case "*"
        echo "invalid preset $preset" >&2
    end
end
