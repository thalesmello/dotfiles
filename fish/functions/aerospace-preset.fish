function aerospace-preset
    set preset $argv[1]
    set -e argv[1]
    argparse \
        'back-workspace=!test -n "$_flag_value"' \
        -- $argv

    set current_workspace (aerospace list-workspaces --focused --format "%{workspace}")
    set back_workspace "$_flag_back_workspace"

    if test -z "$back_workspace"
        set back_workspace 2
    end

    if test "$back_workspace" = "$current_workspace"
        set back_workspace 1
    end

    if test "$preset" = "move-other-windows"
        set current_window (aerospace list-windows --focused --format '%{window-id}')
        set windows (aerospace list-windows --workspace $current_workspace --format "%{window-id}")

        for window in $windows
            test "$window" = "$current_window"; and continue
            aerospace move-node-to-workspace --window-id $window $back_workspace
        end
    end
end

complete -c aerospace-preset -f
complete -c aerospace-preset -n "__fish_is_nth_token 1" -f -d "Name of the preset to use" -a "move-other-windows"
complete -c aerospace-preset -n "test (count (commandline -opc)) -gt 1" -x -l "back-workspace" -d "Workspace to send windows to" -a "(aerospace list-workspaces --all --format '%{workspace}%{tab}%{monitor-name}')"
