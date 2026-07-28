function __aerospace_complete_workspace_app
    set workspaces (aerospace list-workspaces --all --format '%{workspace}')
    set apps (aerospace list-apps --format ':%{app-name}')

    for completion in $workspaces$apps
        echo $completion
    end
end

function __aerospace_complete_workspace_window
    set workspaces (aerospace list-workspaces --all --format '%{workspace}')
    # Some windows have no title, so we add a character so the format string isn't empty
    # Prevents a segfault error
    set windows (aerospace list-windows --all --format ':%{window-title}')

    for completion in $workspaces$windows
        echo $completion
    end
end

complete -c aerospace-preset -f
complete -c aerospace-preset -n "__fish_is_nth_token 1" -f -d "Name of the preset to use" -a "
    move-other-windows move-all-windows-in-workspace minimize-windows minimize-other-windows arrange-workspaces
    move-to-previous-workspace move-all-but-two move-window summon
    focus-window focus-window-id focus-space move-window-to-space focus-window-in-stack
    focus-window-in-space move-window-in-stack focus-display-with-fallback
    smart-move-window-to-next-display stack-or-warp-window minimize
    deminimize-last deminimize-all unstack-window toggle-window-zoom-or-fullscreen
    smart-toggle-fullscreen toggle-monocle-mode stack-windows-in-space
    toggle-yabai toggle-wm restart-wm is-window-floating print-window-mode
    print-yabai-widget print-wm-widget focus-topmost swap-window warp-window
    toggle-float toggle-split balance flatten resize focus-recent focus-back-and-forth
    arrange-spaces focus-app focus-pid minimize-pid unstacked-swap-largest
    minimize-after-nth-window layout-stack layout-bsp layout-float
    insert-direction mirror rotate
"
complete -c aerospace-preset -n "test (count (commandline -opc)) -gt 1" -x -l "back-workspace" -d "Workspace to send windows to" -a "(aerospace list-workspaces --all --format '%{workspace}%{tab}%{monitor-name}')"
complete -c aerospace-preset -n "__fish_seen_subcommand_from arrange-workspaces" -x -s "a" -l "app" -d "WORKSPACE:APP_NAME specification" -a "(__aerospace_complete_workspace_app)"
complete -c aerospace-preset -n "__fish_seen_subcommand_from arrange-workspaces" -x -s "w" -l "window" -d "WORKSPACE:WINDOW_TITLE specification" -a "(__aerospace_complete_workspace_window)"
complete -c aerospace-preset -n "__fish_seen_subcommand_from summon" -x -s "a" -l "app" -d "APP_NAME specification" -a "(aerospace list-apps --format '%{app-name}')"
complete -c aerospace-preset -n "__fish_seen_subcommand_from summon" -x -s "w" -l "window" -d "WINDOW_TITLE specification" -a "(aerospace list-windows --all --format ':%{window-title}' | string sub -s 2 | string match -vr '^\$' )"
complete -c aerospace-preset -n "__fish_seen_subcommand_from summon" -f -l "move-others" -d "Move other windows to back workspace"
complete -c aerospace-preset -n "__fish_seen_subcommand_from summon" -f -l "minimize-others" -d "Minimize other windows"
complete -c aerospace-preset -n "__fish_seen_subcommand_from move-to-previous-workspace" -f -l "move-others" -d "Move other windows to back workspace"
complete -c aerospace-preset -n "__fish_seen_subcommand_from move-all-windows-in-workspace" -x -l "from" -d "Source workspace" -a "(aerospace list-workspaces --all --format '%{workspace}%{tab}%{monitor-name}')"
complete -c aerospace-preset -n "__fish_seen_subcommand_from move-all-windows-in-workspace" -x -l "to" -d "Destination workspace" -a "(aerospace list-workspaces --all --format '%{workspace}%{tab}%{monitor-name}')"
