function aerospace-preset
    set preset $argv[1]
    set -e argv[1]
    argparse -i \
        'back-workspace=!test -n "$_flag_value"' \
        -- $argv

    set current_workspace (aerospace list-workspaces --focused --format "%{workspace}")
    set back_workspace "$_flag_back_workspace"
    set current_window (aerospace list-windows --focused --format '%{window-id}')
    set windows (aerospace list-windows --workspace $current_workspace --format "%{window-id}")
    set other_windows (string match -v -e "$current_window" $windows)

    if test -z "$back_workspace"
        set back_workspace 2
    end

    if test "$back_workspace" = "$current_workspace"
        set back_workspace 1
    end

    if test "$preset" = "move-other-windows"
        for window in $other_windows
            aerospace move-node-to-workspace --window-id $window $back_workspace
        end
    else if test "$preset" = "minimize-other-windows"
        for window in $other_windows
            aerospace focus --window-id $window
            aerospace macos-native-minimize
        end
    else if test "$preset" = "minimize-windows"
        for window in $windows
            aerospace focus --window-id $window
            aerospace macos-native-minimize
        end
    else if test "$preset" = "move-to-previous-workspace"
        argparse -i 'move-others=?' -- $argv

        set summon_window (aerospace list-windows --focused --format '%{window-id}')
        aerospace workspace-back-and-forth
        set workspace (aerospace list-workspaces --focused --format '%{workspace}')
        set other_window (aerospace list-windows --focused --format '%{window-id}')

        if set -q _flag_move_others
            for window in (aerospace list-windows --workspace focused --format '%{window-id}')
                contains $window $summon_window $other_window; and continue
                aerospace move-node-to-workspace --window-id $window $back_workspace
            end
        end

        aerospace move-node-to-workspace --window-id $summon_window $workspace
        aerospace focus --window-id $summon_window
    else if test "$preset" = "move-all-but-two"
        set main_window (aerospace list-windows --focused --format '%{window-id}')
        aerospace focus-back-and-forth; or aerospace workspace-back-and-forth
        set workspace (aerospace list-workspaces --focused --format '%{workspace}')
        set other_window (aerospace list-windows --focused --format '%{window-id}')

        for window in (aerospace list-windows --workspace focused --format '%{window-id}')
            contains $window $main_window $other_window; and continue
            aerospace move-node-to-workspace --window-id $window $back_workspace
        end

        aerospace move-node-to-workspace --window-id $main_window $workspace
        aerospace focus --window-id $main_window
    else if test "$preset" = "arrange-workspaces"
        set windows
        set workspaces

        argparse -i \
            'a/app=+' \
            'w/window=+' \
            'keep-windows' \
            -- $argv

        for line in "%{app-name}:"$_flag_app "%{window-title}:"$_flag_window
            echo $line | read -l -d: format workspace filter

            for line2 in (aerospace list-windows --all --format "%{window-id}:$format:" | string match -er ":$filter:")
                echo $line2 | read -l -d: window __

                set -a specs "$workspace:$window"
                set -a workspaces "$workspace"
                set -a windows "$window"
            end
        end

        if not set -q _flag_keep_windows
            set workspaces (printf '%s\n' $workspaces | sort -un)

            echo workspaces $workspaces
            echo windows $windows

            if contains $current_workspace $workspaces
                set back_workspace (math 1 + $workspaces[-1])
            end

            # Move windows to back workspace
            for workspace in $workspaces
                for window in (aerospace list-windows --workspace $workspace --format '%{window-id}')
                    contains $window $windows; and continue

                    aerospace move-node-to-workspace --window-id $window $back_workspace
                end
            end
        end

        for line in $specs
            echo $line | read -d: workspace window
            aerospace move-node-to-workspace --window-id $window $workspace
        end

    else if test "$preset" = "summon"
        argparse -i \
            --exclusive move-others,minimize-others \
            'a/app=+' \
            'w/window=+' \
            'move-others=?' \
            'minimize-others=?' \
            -- $argv

        if set -q _flag_minimize_others
            aerospace-preset minimize-other-windows
        end

        if set -q _flag_move_others
            aerospace-preset move-other-windows
        end

        set workspace (aerospace list-workspaces --focused --format '%{workspace}')
        set arrange_args "--app=$workspace:"$_flag_app "--window=$workspace:"$_flag_window
        aerospace-preset arrange-workspaces --keep-windows $arrange_args
    end
end

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
complete -c aerospace-preset -n "__fish_is_nth_token 1" -f -d "Name of the preset to use" -a "move-other-windows minimize-windows minimize-other-windows arrange-workspaces move-to-previous-workspace move-all-but-two"
complete -c aerospace-preset -n "test (count (commandline -opc)) -gt 1" -x -l "back-workspace" -d "Workspace to send windows to" -a "(aerospace list-workspaces --all --format '%{workspace}%{tab}%{monitor-name}')"
complete -c aerospace-preset -n "__fish_seen_subcommand_from arrange-workspaces" -x -s "a" -l "app" -d "WORKSPACE:APP_NAME specification" -a "(__aerospace_complete_workspace_app)"
complete -c aerospace-preset -n "__fish_seen_subcommand_from arrange-workspaces" -x -s "w" -l "window" -d "WORKSPACE:WINDOW_TITLE specification" -a "(__aerospace_complete_workspace_window)"
complete -c aerospace-preset -n "__fish_seen_subcommand_from summon" -x -s "a" -l "app" -d "APP_NAME specification" -a "(aerospace list-apps --format '%{app-name}')"
complete -c aerospace-preset -n "__fish_seen_subcommand_from summon" -x -s "w" -l "window" -d "WINDOW_TITLE specification" -a "(aerospace list-windows --all --format ':%{window-title}' | string sub -s 2 | string match -vr '^\$' )"
complete -c aerospace-preset -n "__fish_seen_subcommand_from summon" -f -l "move-others" -d "Move other windows to back workspace"
complete -c aerospace-preset -n "__fish_seen_subcommand_from summon" -f -l "minimize-others" -d "Minimize other windows"
complete -c aerospace-preset -n "__fish_seen_subcommand_from move-to-previous-workspace" -f -l "move-others" -d "Move other windows to back workspace"
