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
    else if test "$preset" = "arrange-workspaces"
        argparse -i \
            'a/app=+' \
            'w/window=+' \
            'keep-windows' \
            -- $argv

        if not set -q _flag_keep_windows
            set workspaces (
            string split -f1 ':' $_flag_app
            string split -f1 ':' $_flag_window
            )

            if contains $current_workspace $workspaces
                set back_workspace (math 1 + (printf '%s\n' $workspaces | sort)[-1])
            end

            # Move windows to back workspace
            for workspace in $workspaces
                for window in (aerospace list-windows --workspace $workspace --format '%{window-id}')
                    aerospace move-node-to-workspace --window-id $window $back_workspace
                end
            end
        end

        for line in $_flag_app
            echo $line | read -l -d: workspace app

            aerospace list-windows --all --format '%{window-id}:%{app-name}:' | rg ":$app:" | while read -l -d: window __
                aerospace move-node-to-workspace --window-id $window $workspace
            end
        end

        for line in $_flag_window
            echo $line | read -l -d: workspace window_title

            aerospace list-windows --all --format '%{window-id}:%{window-title}:' | rg ":$window_title:" | while read -l -d: window __
                aerospace move-node-to-workspace --window-id $window $workspace
            end
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
complete -c aerospace-preset -n "__fish_is_nth_token 1" -f -d "Name of the preset to use" -a "move-other-windows minimize-windows minimize-other-windows arrange-workspaces"
complete -c aerospace-preset -n "test (count (commandline -opc)) -gt 1" -x -l "back-workspace" -d "Workspace to send windows to" -a "(aerospace list-workspaces --all --format '%{workspace}%{tab}%{monitor-name}')"
complete -c aerospace-preset -n "__fish_seen_subcommand_from arrange-workspaces" -x -s "a" -l "app" -d "WORKSPACE:APP_NAME specification" -a "(__aerospace_complete_workspace_app)"
complete -c aerospace-preset -n "__fish_seen_subcommand_from arrange-workspaces" -x -s "w" -l "window" -d "WORKSPACE:WINDOW_TITLE specification" -a "(__aerospace_complete_workspace_window)"
complete -c aerospace-preset -n "__fish_seen_subcommand_from summon" -x -s "a" -l "app" -d "APP_NAME specification" -a "(aerospace list-apps --format '%{app-name}')"
complete -c aerospace-preset -n "__fish_seen_subcommand_from summon" -x -s "w" -l "window" -d "WINDOW_TITLE specification" -a "(aerospace list-windows --all --format ':%{window-title}' | string sub -s 2 | string match -vr '^\$' )"
complete -c aerospace-preset -n "__fish_seen_subcommand_from summon" -f -l "move-others" -d "Move other windows to back workspace"
complete -c aerospace-preset -n "__fish_seen_subcommand_from summon" -f -l "minimize-others" -d "Minimize other windows"
