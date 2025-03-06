function aerospace-auto-summon
    argparse \
        'when-workspace=' \
        'focused-workspace=' \
        'previous-workspace=' \
        -- $argv

    set focused_workspace (default "$_flag_focused_workspace" "$AEROSPACE_FOCUSED_WORKSPACE")
    set previous_workspace (default "$_flag_previous_workspace" "$AEROSPACE_PREV_WORKSPACE")

    echo runs $focused_workspace $_flag_when_workspace

    if test "$focused_workspace" != "$_flag_when_workspace"
        return 0
    end

    echo prev workspace

    aerospace move-node-to-workspace --focus-follows-window "$previous_workspace"
end

complete -c aerospace-auto-summon -f
complete -c aerospace-auto-summon -l "when-workspace"
complete -c aerospace-auto-summon -l "previous-workspace"
complete -c aerospace-auto-summon -l "focused-workspace"
