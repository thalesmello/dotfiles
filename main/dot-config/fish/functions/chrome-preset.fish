function chrome-preset
    set preset $argv[1]
    set -e argv[1]

    switch "$preset"
    case "pin-tab"
        set position $argv[1]
        set -e argv[1]

        set json (jq -n --argjson tab "$(env OUTPUT_FORMAT=json chrome-cli info)" --argjson windows "$(yabai -m query --windows --space)" '{tab_id: $tab.id, window_id: ($windows | first(.[] | select(."has-focus"))).id}')

        mkdir -p "/tmp/chrome-preset/pinned-tabs/"
        echo $json > "/tmp/chrome-preset/pinned-tabs/$position.json"
        display-message "Pin tab $position"
    case "focus-pinned-tab"
        set position $argv[1]
        set -e argv[1]

        read json < "/tmp/chrome-preset/pinned-tabs/$position.json"

        chrome-cli activate -t "$(jq -nr --argjson json "$json" '$json.tab_id')"
        yabai -m window --focus "$(jq -nr --argjson json "$json" '$json.window_id')"

        display-message "Focus tab $position"
    case "focus-window"
        set window_id $argv[1]
        set -e argv[1]

        osascript -e "tell application \"Google Chrome\"
            set index of (first window whose id is $window_id) to 1
            activate
        end tell"
        or return 1
    case "focus-url"
        set regex $argv[1]
        set -e argv[1]

        env OUTPUT_FORMAT=json chrome-cli list links \
        | jq -er --arg regex "$regex" '
        first(.tabs.[] | select(.url | test($regex)))
        | "\(.windowId):\(.id)"' \
        | read -d: -l chrome_window_id tab_id

        # set tab_index (env OUTPUT_FORMAT=json chrome-cli list tabs -w "$chrome_window_id" \
        # | jq -r --arg tab_id "$tab_id" '.tabs | map(.id) | index($tab_id) + 1')

        chrome-preset focus-window "$chrome_window_id"
        and chrome-cli activate -t "$tab_id"
        # and if test "$tab_index" -le 8
        #     # Index is <= 8 then it's faster to use cmd + index
        #     btt-preset send-keys cmd "$tab_index"
        # else
        #     chrome-cli activate -t "$tab_id"
        # end

        or return 1

    case "focus-or-open-url"
        argparse fallback= profile= label= -- $argv
        or return 1

        set regex $argv[1]
        set -e argv[1]

        if test -n "$_flag_fallback"
            set url "$_flag_fallback"
        else
            set url "$regex"
            set regex (string escape --style=regex "$regex")
        end

        if test -n "$_flag_label"
            display-message "Open $_flag_label"
        end

        chrome-preset focus-url "$regex"
        or chrome-preset open-url --profile="$_flag_profile" "$url"
    case "open-url"
        argparse profile= label= -- $argv
        or return 1

        set url $argv[1]
        set -e argv[1]

        if test -n "$_flag_label"
            display-message "Open $_flag_label"
        end

        if not string match -qr '^https?://' "$url"
            set url "https://$url"
        end


        if test -n "$_flag_profile"
            open -n -a "Google Chrome" --args "$url" --profile-directory="$_flag_profile"
        else
            open -n -a "Google Chrome" --args "$url"
        end
    case "close-tabs-with-url"
        set regex $argv[1]
        set -e argv[1]

        set tabs (env OUTPUT_FORMAT=json chrome-cli list links \
        | jq -er --arg regex "$regex" '
        .tabs.[]
        | select(.url | test($regex))
        | debug(.)
        | .id')
        and for tab_id in $tabs
            chrome-cli close -t "$tab_id"
        end
        or return 1
    case '*'
        return 1
    end
end
