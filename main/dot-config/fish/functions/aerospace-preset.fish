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
        set back_workspace (math 1 + "$current_workspace" 2>/dev/null; or echo 2)

        if test "$back_workspace" -gt 9
            set back_workspace 1
        end
    end

    if test "$back_workspace" = "$current_workspace"
        set back_workspace 1
    end

    switch "$preset"
    case "move-other-windows"
        for window in $other_windows
            aerospace move-node-to-workspace --window-id $window $back_workspace
        end
    case "move-window"
        aerospace move-node-to-workspace $back_workspace
    case "minimize-other-windows"
        for window in $other_windows
            aerospace focus --window-id $window
            aerospace macos-native-minimize
        end
    case "minimize-windows"
        for window in $windows
            aerospace focus --window-id $window
            aerospace macos-native-minimize
        end
    case "move-to-previous-workspace"
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
    case "move-all-but-two"
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
    case "arrange-workspaces"
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

    case "summon"
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
    case "focus-window"
        set direction $argv[1]
        set -e argv[1]
        set aero_dir (__wm_translate_direction $direction)
        aerospace focus --boundaries-action fail --ignore-floating $aero_dir
        or return 1
    case "focus-floating-window"
        set direction $argv[1]
        set -e argv[1]

        # Get floating window IDs from aerospace
        set floating_ids (aerospace list-windows --workspace focused --format '%{window-id}:%{window-layout}' | string match -er ':floating$' | string replace -r ':.*' '')
        if test (count $floating_ids) -eq 0
            return 1
        end

        set focused_id (aerospace list-windows --focused --format '%{window-id}')
        set ids_json (printf '%s\n' $floating_ids | jq -Rn '[inputs | tonumber]')

        set window_id

        switch "$direction"
            case next prev first last
                set window_id (yabai -m query --windows | jq -er \
                    --argjson ids "$ids_json" \
                    --argjson focused "$focused_id" \
                    --arg dir "$direction" '
                    map(select(.id as $id | $ids | index($id)))
                    | sort_by([.frame.x, .frame.y, .id])
                    | (map(.id) | index($focused)) as $pos
                    | if $pos == null then first.id
                      else ({first: 0, last: (length - 1), prev: ($pos - 1), next: ($pos + 1)}[$dir]) as $target
                      | if $target < 0 or $target >= length then null
                        else .[$target].id end
                      end')
            case east west north south
                set window_id (yabai -m query --windows | jq -er \
                    --argjson ids "$ids_json" \
                    --argjson focused "$focused_id" \
                    --arg dir "$direction" '
                    map(select(.id as $id | $ids | index($id)))
                    | (first(.[] | select(.id == $focused)) // .[0]) as $cur
                    | map(select(.id != $focused))
                    | map(select(
                        if $dir == "east" then .frame.x >= ($cur.frame.x + $cur.frame.w / 2)
                        elif $dir == "west" then (.frame.x + .frame.w) <= ($cur.frame.x + $cur.frame.w / 2)
                        elif $dir == "south" then .frame.y >= ($cur.frame.y + $cur.frame.h / 2)
                        elif $dir == "north" then (.frame.y + .frame.h) <= ($cur.frame.y + $cur.frame.h / 2)
                        else false end))
                    | sort_by(
                        ((.frame.x + .frame.w/2) - ($cur.frame.x + $cur.frame.w/2)) as $dx
                        | ((.frame.y + .frame.h/2) - ($cur.frame.y + $cur.frame.h/2)) as $dy
                        | ($dx*$dx + $dy*$dy))
                    | first.id')
            case left right up down
                set aero_dir (__wm_translate_direction $direction)
                aerospace-preset focus-floating-window $aero_dir
                return $status
            case '*'
                echo "Invalid argument: $direction" >&2
                return 1
        end

        if test "$status" = 0 -a -n "$window_id"
            aerospace focus --window-id $window_id
        else
            return 1
        end
    case "focus-space"
        set space $argv[1]
        set -e argv[1]

        switch "$space"
            case next
                aerospace workspace --wrap-around next
            case prev
                aerospace workspace --wrap-around prev
            case recent
                aerospace workspace-back-and-forth
            case '*'
                aerospace workspace $space
        end
    case "move-window-to-space"
        set space $argv[1]
        set -e argv[1]

        switch "$space"
            case next
                aerospace move-node-to-workspace --wrap-around --focus-follows-window next
            case prev
                aerospace move-node-to-workspace --wrap-around --focus-follows-window prev
            case recent
                aerospace-preset move-to-previous-workspace
            case '*'
                aerospace move-node-to-workspace --focus-follows-window $space
        end
    case "focus-window-in-stack" "focus-window-in-space"
        set direction $argv[1]
        set -e argv[1]

        switch "$direction"
        case next
            aerospace focus --boundaries-action fail --ignore-floating dfs-next
        case prev
            aerospace focus --boundaries-action fail --ignore-floating dfs-prev
        end
        return "$status"

    case "move-window-in-stack"
        set direction $argv[1]
        set -e argv[1]

        switch "$direction"
            case next
                aerospace swap --wrap-around dfs-next
            case prev
                aerospace swap --wrap-around dfs-prev
        end
    case "focus-display-with-fallback"
        set direction $argv[1]
        set -e argv[1]
        set aero_dir (__wm_translate_direction $direction)
        aerospace focus-monitor --wrap-around $aero_dir
    case "smart-move-window-to-next-display"
        aerospace move-node-to-monitor --wrap-around --focus-follows-window next
    case "stack-or-warp-window"
        set direction $argv[1]
        set -e argv[1]
        set aero_dir (__wm_translate_direction $direction)
        aerospace join-with $aero_dir
    case "minimize"
        aerospace macos-native-minimize
    case "deminimize-last"
        yabai-preset deminimize-last
    case "deminimize-all"
        yabai-preset deminimize-all
    case "unstack-window"
        aerospace flatten-workspace-tree
    case "toggle-window-zoom-or-fullscreen" "smart-toggle-fullscreen" "toggle-monocle-mode"
        aerospace fullscreen
    case "stack-windows-in-space"
        aerospace layout accordion
    case "toggle-yabai" "toggle-wm"
        aerospace enable toggle
    case "restart-wm"
        aerospace reload-config
        display-message "AeroSpace config reloaded"
    case "is-window-floating"
        set layout (aerospace list-windows --focused --format '%{window-layout}')
        test "$layout" = floating
        return $status
    case "print-window-mode"
        set layout (aerospace list-windows --focused --format '%{window-layout}')
        switch "$layout"
            case floating
                echo "float"
            case accordion
                echo "accordion"
            case tiles
                echo "tile"
            case '*'
                echo "$layout"
        end
    case "print-yabai-widget" "print-wm-widget"
        set workspace (aerospace list-workspaces --focused --format '%{workspace}')
        set workspace_count (aerospace list-workspaces --monitor all --format '%{workspace}' | count)
        set layout (aerospace list-windows --focused --format '%{window-layout}')

        echo "$layout:$workspace/$workspace_count"
    case "focus-topmost"
        aerospace focus --dfs-index 0
    case "swap-window"
        set direction $argv[1]
        set -e argv[1]
        set aero_dir (__wm_translate_direction $direction)
        aerospace move --boundaries-action fail $aero_dir
        or return 1
    case "warp-window"
        set direction $argv[1]
        set -e argv[1]
        set aero_dir (__wm_translate_direction $direction)
        aerospace join-with $aero_dir
    case "toggle-float"
        aerospace layout floating tiling
    case "toggle-split"
        aerospace layout horizontal vertical
    case "balance"
        aerospace balance-sizes
    case "flatten"
        aerospace flatten-workspace-tree
    case "resize"
        aerospace resize $argv
    case "focus-back-and-forth"
        aerospace focus-back-and-forth; or aerospace workspace-back-and-forth
    case "arrange-spaces"
        aerospace-preset arrange-workspaces $argv
    case "focus-pid"
        set pid $argv[1]
        set -e argv[1]

        set window_id (aerospace list-windows --all --json | jq -r --argjson pid "$pid" 'first(.[] | select(."app-pid" == $pid)) | ."window-id"')
        if test -n "$window_id"
            aerospace focus --window-id $window_id
        else
            return 1
        end
    case "minimize-pid"
        set pid $argv[1]
        set -e argv[1]

        set window_id (aerospace list-windows --all --json | jq -r --argjson pid "$pid" 'first(.[] | select(."app-pid" == $pid)) | ."window-id"')
        if test -n "$window_id"
            aerospace focus --window-id $window_id
            aerospace macos-native-minimize
        else
            return 1
        end
    case "unstacked-swap-largest"
        display-message "Not supported in AeroSpace"
    case "minimize-after-nth-window"
        set nth $argv[1]
        set -e argv[1]

        set all_windows (aerospace list-windows --workspace focused --format '%{window-id}')
        set excess_windows $all_windows[(math $nth + 1)..]

        for window in $excess_windows
            aerospace focus --window-id $window
            aerospace macos-native-minimize
        end

        if test (count $excess_windows) -gt 0
            display-message (count $excess_windows)" windows minimized"
        end
    case "layout-stack"
        aerospace layout accordion horizontal vertical
    case "layout-bsp"
        aerospace layout tiles horizontal vertical
    case "layout-float"
        aerospace enable toggle
        if aerospace list-workspaces --focused --format '%{workspace}' &>/dev/null
            display-message "AeroSpace enabled"
        else
            display-message "AeroSpace disabled"
        end
    case "insert-direction"
        display-message "Not supported in AeroSpace"
    case "mirror"
        display-message "Not supported in AeroSpace"
    case "rotate"
        display-message "Not supported in AeroSpace"
    case "*"
        echo "command not found - $preset" >&2
        return 1
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
complete -c aerospace-preset -n "__fish_is_nth_token 1" -f -d "Name of the preset to use" -a "
    move-other-windows minimize-windows minimize-other-windows arrange-workspaces
    move-to-previous-workspace move-all-but-two move-window summon
    focus-window focus-space move-window-to-space focus-window-in-stack
    focus-window-in-space move-window-in-stack focus-display-with-fallback
    smart-move-window-to-next-display stack-or-warp-window minimize
    deminimize-last deminimize-all unstack-window toggle-window-zoom-or-fullscreen
    smart-toggle-fullscreen toggle-monocle-mode stack-windows-in-space
    toggle-yabai toggle-wm restart-wm is-window-floating print-window-mode
    print-yabai-widget print-wm-widget focus-topmost swap-window warp-window
    toggle-float toggle-split balance flatten resize focus-back-and-forth
    arrange-spaces focus-pid minimize-pid unstacked-swap-largest
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
