function aerospace-on-workspace-change
    aerospace-auto-summon \
        --when-workspace "?"
    aerospace-sticky-windows \
        --except-workspace "?" \
        -w "Picture in Picture" \
        -w ".*about:blank - Thales \(Personal\).*"
end
