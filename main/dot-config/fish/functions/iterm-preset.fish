function iterm-preset
    set preset $argv[1]
    set -e argv[1]

    switch "$preset"
    case "new-window"
        osascript -e 'tell application "iTerm2" to create window with default profile'
    case "is-floating-window-active"
        string match -qr -- '<AXApplication: "iTerm2">\s*<AXWindow: "floating-terminal">' "$(btt-preset get-string-variable "focused_element_details")"
    case "hide-floating-terminal"
        iterm-preset is-floating-window-active
        and osascript -e '
            tell application "iTerm2"
                hide hotkey window current window
            end tell
        '
    case "*"
        return
    end
end
