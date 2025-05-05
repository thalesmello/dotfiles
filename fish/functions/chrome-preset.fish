function chrome-preset
    set preset $argv[1]
    set -e argv[1]

    if test "$preset" = "pin-tab"
        set position $argv[1]
        set -e argv[1]

        set json (jq -n --argjson tab "$(env OUTPUT_FORMAT=json chrome-cli info)" --argjson windows "$(yabai -m query --windows --space)" '{tab_id: $tab.id, window_id: ($windows | first(.[] | select(."has-focus"))).id}')

        mkdir -p "/tmp/chrome-preset/pinned-tabs/"
        echo $json > "/tmp/chrome-preset/pinned-tabs/$position.json"
        display-message "Pin tab $position"
    else if test "$preset" = "focus-pinned-tab"
        set position $argv[1]
        set -e argv[1]

        read json < "/tmp/chrome-preset/pinned-tabs/$position.json"

        chrome-cli activate -t "$(jq -nr --argjson json "$json" '$json.tab_id')"
        yabai -m window --focus "$(jq -nr --argjson json "$json" '$json.window_id')"

        display-message "Focus tab $position"
    else if test "$preset" = "focus-window"
        set window_id $argv[1]
        set -e argv[1]

        echo window_id $window_id
        osascript -e "tell application \"Google Chrome\" to set index of (first window whose id is $window_id) to 1"
        and open -a "Google Chrome"
    else if test "$preset" = "focus-url"
        set url $argv[1]
        set -e argv[1]

        echo args
        env OUTPUT_FORMAT=json chrome-cli list links \
            | jq -r --arg url "$url" '
                first(.tabs.[] | select(.url | test($url)))
                | "\(.windowId):\(.id)"' \
            | read -d: window_id tab_id
        echo $window_id $tab_id
        chrome-preset focus-window "$window_id"
        chrome-cli activate -t "$tab_id"
    end
end
