function aerospace-auto-summon
    argparse \
        'when-workspace=' \
        'focused-workspace=' \
        'previous-workspace=' \
        'disable-once' \
        'disable' \
        'enable' \
        -- $argv

    if set -q _flag_disable_once
        set -U __AEROSPACE_AUTO_SUMMON_DISABLE_ONCE 1
        return 0
    end

    if set -q _flag_disable
        set -U __AEROSPACE_AUTO_SUMMON_DISABLE 1
        return 0
    end

    if set -q _flag_enable
        set -eU __AEROSPACE_AUTO_SUMMON_DISABLE 1
        return 0
    end

    if set -qU __AEROSPACE_AUTO_SUMMON_DISABLE
        return 0
    end

    set focused_workspace (default "$_flag_focused_workspace" "$AEROSPACE_FOCUSED_WORKSPACE")
    set previous_workspace (default "$_flag_previous_workspace" "$AEROSPACE_PREV_WORKSPACE")

    if test "$focused_workspace" != "$_flag_when_workspace"
        return 0
    end

    if set -qU __AEROSPACE_AUTO_SUMMON_DISABLE_ONCE
        set -eU __AEROSPACE_AUTO_SUMMON_DISABLE_ONCE
        return 0
    end

    aerospace move-node-to-workspace --focus-follows-window "$previous_workspace"
end

complete -c aerospace-auto-summon -f
complete -c aerospace-auto-summon -l "when-workspace"
complete -c aerospace-auto-summon -l "previous-workspace"
complete -c aerospace-auto-summon -l "focused-workspace"
complete -c aerospace-auto-summon -l "disable-once"
complete -c aerospace-auto-summon -l "disable"
complete -c aerospace-auto-summon -l "enable"
