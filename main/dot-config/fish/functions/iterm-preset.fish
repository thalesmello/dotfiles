function iterm-preset
    set preset $argv[1]
    set -e argv[1]

    switch "$preset"
    case "new-window"
        osascript -e 'tell application "iTerm2" to create window with default profile'
    case "*"
        return *
    end
end
