function aerospace-on-workspace-change
    aerospace-auto-summon --when-workspace 0
    aerospace-sticky-windows \
        --except-workspace 0 \
        -w "Picture in Picture" \
        -w ".*about:blank - Thales \(Personal\).*"
end
