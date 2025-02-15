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
        #argparse -i \
        #    'arg=+' \
        #    -- $argv
        #
        #set workspaces (string split -f1 '|' $_flag_arg)
        #
        #if contains $current_workspace $workspaces
        #    set back_workspace (math 1 + (printf '%s\n' $workspaces | sort)[-1])
        #end
        #
        #for arg in $_flag_arg
        #    echo $arg | read -d '|' workspace app
        #
        #    aerospace workspace $workspace
        #
        #    for window in (aerspace list-windows --workspace focused --format '%{window-id}')
        #        aerospace move-node-to-workspace --window-id $window $back_workspace
        #    end
        #
        #    for 
        #end
        #aerospace workspace
        #
        #for window in $windows
        #    aerospace focus --window-id $window
        #    aerospace macos-native-minimize
        #end
    end
end

complete -c aerospace-preset -f
complete -c aerospace-preset -n "__fish_is_nth_token 1" -f -d "Name of the preset to use" -a "move-other-windows minimize-windows minimize-other-windows"
complete -c aerospace-preset -n "test (count (commandline -opc)) -gt 1" -x -l "back-workspace" -d "Workspace to send windows to" -a "(aerospace list-workspaces --all --format '%{workspace}%{tab}%{monitor-name}')"
