set FILE "$HOME/.yabai-harpoon.json"

function yabai-harpoon
    set mode $argv[1]
    set -e argv[1]

    switch "$mode"
    case "add"
        set pin (yabai-harpoon get-focused-pin-json)

        begin
            yabai-harpoon get-pins-from-file
            echo "$pin"
        end | yabai-harpoon write-pins-to-file

        and set json (cat "$FILE")

        and jq -nr --argjson pin "$pin" --argjson json "$json" '$pin.type, ($json.pins | length)' | read --line type count_pins

        and display-message "Add $type to pin $count_pins"
    case "reset-file"
        echo '{ "pins": [] }' > "$FILE"
    case "delete"
        yabai-harpoon reset-file
        display-message "Delete list"
    case "rewrite-pins-in-file"
        yabai-harpoon get-pins-from-file | yabai-harpoon normalize-pins | yabai-harpoon write-pins-to-file
    case "edit"
        display-message "Edit Yabai-harpoon"

        set tmpfile (mktemp --suffix ".js")

        and yabai-harpoon get-pins-from-file | yabai-harpoon normalize-pins > "$tmpfile"

        set -l modified_before (stat -c %y "$tmpfile")

        neovim-ghost edit "$tmpfile" -c "setlocal nowrap"

        set -l modified_after (stat -c %y "$tmpfile")


        if test "$modified_before" != "$modified_after"
            yabai-harpoon write-pins-to-file < "$tmpfile"
            display-message "Updated list"
        else
            display-message "Exit Update"
        end

    case "get-pin"
        set position $argv[1]
        set -e argv[1]

        jq -ec --argjson pos "$position" '.pins[$pos - 1]' < "$FILE"
        return $status
    case "focus"
        set position $argv[1]
        set -e argv[1]

        if test ! -e "$FILE"
            yabai-harpoon reset-file
        end

        set json (yabai-harpoon get-pin "$position")
        and display-message "Focus $position"
        or begin
            display-message "Pin $position inexistant"
            return 1
        end

        echo $json | yabai-harpoon focus-pin-json
        or begin
            display-message "Refreshing Pins"
            yabai-harpoon rewrite-pins-in-file
            and yabai-harpoon get-pin "$position" | yabai-harpoon focus-pin-json
        end
    case "focus-pin-json"
        read json

        set type (jq -nr --argjson json "$json" '$json.type')

        set has_failed 0

        if jq -en --arg type "$type" '$type == "chrome_tab"' >/dev/null
            chrome-cli activate -t "$(jq -nr --argjson json "$json" '$json.tab_id')"
            and chrome-preset focus-window "$(jq -nr --argjson json "$json" '$json.tab_window_id')"
            chrome-preset check-tab-id "$(jq -nr --argjson json "$json" '$json.tab_id')" >/dev/null
            or set has_failed 1
        else if jq -en --arg type "$type" '$type == "chrome_preset_app"' >/dev/null
            set url (jq -nr --argjson json "$json" '$json.uuid')
            set app (string escape --style=var "$url" | string sub --length 100)
            # TODO: profile name needs to be fetched from the json
            # it can be done by checking the name of the window using the yabai -m query subcommand
            chrome-preset alternate-app --minimize --profile "Default" --app "$app" "$url"
        else if jq -en --arg type "$type" '$type == "chrome_search_tab"' >/dev/null
            chrome-cli activate -t "$(jq -nr --argjson json "$json" '$json.tab_id')"
            and chrome-preset focus-or-open-url "$(jq -nr --argjson json "$json" '$json.uuid')"
            or set has_failed 1
        else if jq -en --arg type "$type" '$type == "window"' >/dev/null
            yabai -m window --focus "$(jq -nr --argjson json "$json" '$json.window_id')"
            or set has_failed 1
        else
            set type unkown_pin
            set has_failed 1
        end

        if test $has_failed = 1
            return 1
        end
    case "get-focused-pin-json"
        set window (yabai -m query --windows --space | jq  'first(.[] | select(."has-focus"))')

        if jq -en --argjson window "$window" '$window.app == "Google Chrome"' >/dev/null
            set chrome_tab (env OUTPUT_FORMAT=json chrome-cli info | string collect)
            set json (jq -n --argjson chrome_tab "$chrome_tab" --argjson window "$window" '{app: $window.app, title: $chrome_tab.title, type: "chrome_tab", uuid: ({chrome_tab: $chrome_tab.id} | @base64), tab_id: $chrome_tab.id, tab_window_id: $chrome_tab.windowId, url: $chrome_tab.url}')
        else
            set json (jq -n --argjson window "$window" '{app: $window.app,  title: $window.title, type: "window", uuid: ({window: $window.id} | @base64), window_id: $window.id}')
        end

        echo "$json"
    case "get-pins-from-file"
        if test ! -e "$FILE"
            yabai-harpoon reset-file
        end

        jq -c '.pins[]' < "$FILE"
    case "write-pins-to-file"
        jq -s '{ pins: [. | to_entries | unique_by(.value.uuid) | sort_by(.key) | .[] | .value] }' > "$FILE"
    case "normalize-pins"
        set yabai_wins (yabai -m query --windows | string collect)
        set chrome_tabs (env OUTPUT_FORMAT=json chrome-cli list tabs | string collect)

        jq -c --argjson "yabai_wins" "$yabai_wins" --argjson "chrome_tabs" "$chrome_tabs" '
            ($yabai_wins | map({({window: .id} | @base64): {title}}) | add) as $yabai_registry
            | ($chrome_tabs | .tabs | map({({chrome_tab: .id} | @base64): {title, tab_window_id: .windowId, url}}) | add) as $chrome_registry
            | ($chrome_tabs | .tabs | map({(.url): {title, tab_window_id: .windowId, tab_id: .id, uuid: ({chrome_tab: .id} | @base64), url: .url, type: "chrome_tab"}}) | add) as $chrome_urls
            | $yabai_registry + $chrome_registry as $registry
            | try (. + ($registry[.uuid] // $chrome_urls[.url]? // error(.)))
                catch try (
                        if .type == "chrome_tab" then
                            # {"uuid": .url, type: "chrome_search_tab"}
                            {"uuid": .url, type: "chrome_preset_app"}
                        elif .type == "chrome_preset_app" then
                            .
                        elif .type == "chrome_search_tab" then
                            $chrome_urls[.uuid] // .
                        else error(.) end
                    )
                    catch {type: "window_not_found"}
            '
    end
end

complete -c yabai-harpoon -f
complete -c yabai-harpoon -d "mode" -a "add delete edit"
