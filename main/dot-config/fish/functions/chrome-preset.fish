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
    case "check-url"
        set regex $argv[1]
        set -e argv[1]

        set json (env OUTPUT_FORMAT=json chrome-cli list links | string collect)
        jq -ern --arg regex "$regex" --argjson json "$json" '
        $json
        | first(.tabs.[] | select(.url | test($regex)))
        | .id'
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
        or chrome-preset open-url --newtab --profile="$_flag_profile" "$url"
        or return 1
    case "check-or-open-url"
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
            display-message "Check $_flag_label"
        end

        chrome-preset check-url "$regex"
        or chrome-preset open-url --newtab --profile="$_flag_profile" "$url"
        or return 1
    case "check-tab-id"
        set tab_id $argv[1]
        set -e argv[1]

        set json (env OUTPUT_FORMAT=json chrome-cli info -t "$tab_id" | string collect)

        test -z "$json"; and return 1

        echo "$json"

    case focus-profile
        set profile $argv[1]
        set -e argv[1]

        set profile_name (jq --arg profile "$profile" -r '.profile.info_cache[$profile] | "\(.gaia_given_name) (\(.name))"' <"$HOME/Library/Application Support/Google/Chrome/Local State")
        and btt-preset show-or-hide-app --only-show "Google Chrome"
        and btt-preset trigger-menu-bar "Profiles;$(string escape --style regex "$profile_name")"

    case "open-url"
        argparse profile= label= newtab newtabright -- $argv
        or return 1

        set url $argv[1]
        set -e argv[1]

        if test -n "$_flag_label"
            display-message "Open $_flag_label"
        end

        if not string match -qr '^https?://' "$url"
            set url "https://$url"
        end

        set app (btt-preset get-string-variable "focused_window_app_name")

        # If app is Chrome and --newtab is absent, open in current tab
        if test "$app" = "Google Chrome" -a -z "$_flag_newtab"
            env OUTPUT_FORMAT=json chrome-cli info | jq -r '.id, .windowId' | read --line tab_id window_id
            set old_window_id "$window_id"

            if test -n "$_flag_profile"
                chrome-preset focus-profile "$_flag_profile"
                env OUTPUT_FORMAT=json chrome-cli info | jq -r '.id, .windowId' | read --line tab_id window_id
            end

            set extra_args

            if test -n "$_flag_newtabright"
                btt-preset trigger-menu-bar "Tab;New Tab to the Right"
                env OUTPUT_FORMAT=json chrome-cli info | jq -r '.id' | read --line tab_id
            end

            set extra_args

            if test "$window_id" = "$old_window_id"
                set -a extra_args -t "$tab_id"
            end

            chrome-cli open "$url" $extra_args
        else
            set extra_args

            if test -n "$_flag_profile"
                set -a extra_args "--profile-directory=$_flag_profile"
            end

            open -n -a "Google Chrome" --args "$url" $extra_args
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

    case "click-selector"
        set selector $argv[1]
        set -e argv[1]

        chrome-cli execute "document.querySelector($(string escape "$selector")).click()"
    case "create-app"
        mkdir -p /tmp/chrome_preset_apps
        argparse profile= -- $argv

        set appname $argv[1]
        set -e argv[1]

        set url $argv[1]
        set -e argv[1]

        yabai -m signal --add \
            event=window_created \
            app='^Google Chrome$' \
            label="store_chrome_preset_app_info" \
            action="echo \$YABAI_WINDOW_ID > '/tmp/chrome_preset_apps/$appname.windowid'; env OUTPUT_FORMAT=json chrome-cli info > '/tmp/chrome_preset_apps/$appname.chromeinfo'; yabai -m signal --remove store_chrome_preset_app_info"

        open -na 'Google Chrome' --args --profile-directory="$_flag_profile" --app="$url"

    case "open-in-app"
        argparse profile= -- $argv

        set appname $argv[1]
        set -e argv[1]

        set url $argv[1]
        set -e argv[1]

        set window (cat "/tmp/chrome_preset_apps/$appname.windowid")

        if yabai-preset get-window-info "$window" >/dev/null
            set app (cat "/tmp/chrome_preset_apps/$appname.chromeinfo")

            chrome-cli open "$url" -t "$(jq -nr --argjson app "$app" '$app.id')"
            yabai -m window "$window" --focus
        else
            chrome-preset create-app --profile="$_flag_profile" "$appname" "$url"
        end
    case "get-app-window-id"
        set appname $argv[1]
        set -e argv[1]

        cat "/tmp/chrome_preset_apps/$appname.windowid" 2>/dev/null
        return $status
    case "focus-or-create-app"
        argparse profile= -- $argv

        set appname $argv[1]
        set -e argv[1]

        set url $argv[1]
        set -e argv[1]

        if set window (chrome-preset get-app-window-id "$appname"); and yabai-preset get-window-info "$window" >/dev/null
            yabai -m window "$window" --focus
        else
            chrome-preset create-app --profile="$_flag_profile" "$appname" "$url"
        end
    case "alternate-app"
        argparse profile= minimize=? hide=? app= -- $argv

        set app "$_flag_app"

        set fallback

        set path "/tmp/chrome_preset_apps/$app.windowid"

        if test -f "$path"
            set app_window_id (cat "$path")

            set active (yabai -m query --windows --window)

            if test "$(jq -nr --argjson active "$active" '$active.id')" = "$app_window_id"
                if set -q _flag_hide
                    skhd -k 'cmd - h'
                else if set -q _flag_minimize
                    yabai-preset "minimize"
                else
                    yabai -m window recent --focus
                end
            else
                set fallback 1
            end
        else
            set fallback 1
        end


        if test -n "$fallback"
            chrome-preset focus-or-create-app --profile "$_flag_profile" "$app" $argv
        end
    case '*'
        return 1
    end
end
