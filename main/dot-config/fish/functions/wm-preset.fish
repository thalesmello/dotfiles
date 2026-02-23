function wm-preset
    if pgrep -xq AeroSpace
        aerospace-preset $argv
    else if pgrep -xq yabai
        yabai-preset $argv
    else
        echo "No window manager running" >&2
        return 1
    end
end

complete -c wm-preset -f
complete -c wm-preset -n "__fish_is_nth_token 1" -f -d "Sub-command" -a "
    focus-window
    focus-space
    move-window-to-space
    focus-window-in-stack
    focus-window-in-space
    move-window-in-stack
    focus-display-with-fallback
    smart-move-window-to-next-display
    stack-or-warp-window
    minimize
    deminimize-last
    deminimize-all
    unstack-window
    toggle-window-zoom-or-fullscreen
    smart-toggle-fullscreen
    toggle-monocle-mode
    stack-windows-in-space
    toggle-wm
    restart-wm
    is-window-floating
    print-window-mode
    print-wm-widget
    focus-topmost
    swap-window
    warp-window
    toggle-float
    toggle-split
    balance
    flatten
    resize
    focus-back-and-forth
    arrange-spaces
    focus-pid
    minimize-pid
    unstacked-swap-largest
    minimize-after-nth-window
    layout-stack
    layout-bsp
    layout-float
    insert-direction
    mirror
    rotate
"
