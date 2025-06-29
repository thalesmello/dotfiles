function aerospace-on-workspace-change
    # Currently too slow. I'm disabling it to check whether it improves performance
    # aerospace-auto-summon \
    #     --when-workspace "?"
    aerospace-sticky-windows \
        --except-workspace "?" \
        -w "Picture in Picture" \
        -w ".*about:blank - Thales \(Personal\).*"
end
