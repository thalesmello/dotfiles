function aerospace-sticky-windows
    argparse \
        'x/except-workspace=+' \
        'focused-workspace=' \
        'previous-workspace=' \
        'a/app=+' \
        'w/window=+' \
        -- $argv

    set focused_workspace (default "$_flag_focused_workspace" "$AEROSPACE_FOCUSED_WORKSPACE")
    set previous_workspace (default "$_flag_previous_workspace" "$AEROSPACE_PREV_WORKSPACE")
    set focused_monitor (aerospace list-workspaces --focused --format '%{monitor-id}')

    if contains $focused_workspace $_flag_except_workspace
        return 0
    end

    for line in "%{app-name}:"$_flag_app "%{window-title}:"$_flag_window
        echo $line | read -l -d: format filter

        for line2 in (aerospace list-windows --all --format "%{window-id}:%{monitor-id}:%{workspace}:$format:" | string match -er ":$filter:\$")
            echo $line2 | read -l -d: window monitor workspace __

            if test "$monitor" != "$focused_monitor" -o "$workspace" = "$focused_workspace"; or contains $workspace $_flag_except_workspace
                continue
            end

            aerospace move-node-to-workspace --window-id "$window" "$focused_workspace"
        end
    end
end

complete -c aerospace-auto-summon -f
complete -c aerospace-auto-summon -l "when-workspace"
complete -c aerospace-auto-summon -l "previous-workspace"
complete -c aerospace-auto-summon -l "focused-workspace"


complete -c aerospace-sticky-windows -f
complete -c aerospace-sticky-windows -l "previous-workspace"
complete -c aerospace-sticky-windows -l "focused-workspace"
complete -c aerospace-sticky-windows -x -s "x" -l "except-workspace"
complete -c aerospace-sticky-windows -x -s "a" -l "app" -d "APP_NAME specification" -a "(aerospace list-apps --format '%{app-name}')"
complete -c aerospace-sticky-windows -x -s "w" -l "window" -d "WINDOW_TITLE specification" -a "(aerospace list-windows --all --format ':%{window-title}' | string sub -s 2 | string match -vr '^\$' )"
