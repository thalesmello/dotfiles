function neovim-ghost
    set preset $argv[1]
    set -e argv[1]

    switch "$preset"
    case "is-alive"
        pgrep -q -F "$TMPDIR/nvim_ghost.pid"
        return $status
    case "focus"
        yabai-preset focus-pid "$(cat "$TMPDIR/nvim_ghost.pid")"
    case "start"
        argparse spawn=? -- $argv

        if set -q _flag_spawn
            fish -c "neovim-ghost start" &
            disown; and return
        end

        display-message "Start GHOST"
        env NVIM_GHOST_ENABLE=1 neovide --frame buttonless --title-hidden -- --listen "$TMPDIR/nvim_ghost.socket" &
        echo "$last_pid" > "$TMPDIR/nvim_ghost.pid"
        wait
        rm "$TMPDIR/nvim_ghost.pid"
    case "trigger"
        if neovim-ghost is-alive
            neovim-ghost focus
        else
            neovim-ghost start --spawn
        end;
    case "focus-or-new-tab"
        set skip_focus 0
        if not neovim-ghost is-alive
            neovim-ghost start --spawn
            sleep 2
            set skip_focus 1
        end

        nvr --nostart --servername "$TMPDIR/nvim_ghost.socket" -c "lua require'vim_utils'.focus_or_new_tab [[$argv]]"

        if test "$skip_focus" != 1
            neovim-ghost focus
        end
    case "edit"
        argparse minimize=? -- $argv
        set skip_focus 0

        if not neovim-ghost is-alive
            neovim-ghost start --spawn
            set skip_focus 1
        end

        nvr --nostart --servername "$TMPDIR/nvim_ghost.socket" --remote-tab-wait +"set bufhidden=delete" +"nnoremap <buffer> <D-CR> ZZ" +"inoremap <buffer> <D-CR> <Esc>ZZ" $argv &

        if test "$skip_focus" != 1
            neovim-ghost focus
        end

        wait

        set -q _flag_minimize; and yabai-preset minimize-pid "$(cat "$TMPDIR/nvim_ghost.pid")"

    case "kill"
        kill -9 "$(cat "$TMPDIR/nvim_ghost.pid")"
        rm "$TMPDIR/nvim_ghost.pid"
        rm "$TMPDIR/nvim_ghost.socket"
    case "*"
        echo "invalid preset $preset" >&2
    end
end
