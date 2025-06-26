set FILE "/tmp/yabai-harpoon.json"

function yabai-harpoon
    set mode $argv[1]
    set -e argv[1]

    switch "$mode"
    case "add"
        set pin_json (yabai-preset get-pin-json)

        and if test ! -e "$FILE"
            yabai-harpoon reset-file
        end

        set json (jq --argjson pin_json "$pin_json" '.pins |= . + [$pin_json]' < "$FILE" | string collect)

        and echo "$json" > "$FILE"

        and set type (jq -nr --argjson json "$pin_json" '$json.type')

        and display-message "Add $type to list"
    case "reset-file"
        echo '{ "pins": [] }' > "$FILE"
    case "delete"
        yabai-harpoon reset-file
        display-message "Delete list"
    case "edit"
        if test ! -e "$FILE"
            yabai-harpoon reset-file
        end

        set tmpfile (mktemp --suffix ".js")

        and jq -c '.pins[]' < "$FILE" > "$tmpfile"

        and neovide "$tmpfile"

        and jq -s '{ pins: . }' < "$tmpfile" > "$FILE"

        and display-message "Updated list"
    case "focus"
        set position $argv[1]
        set -e argv[1]

        if test ! -e "$FILE"
            yabai-harpoon reset-file
        end

        jq -ec --argjson pos "$position" '.pins[$pos - 1]' < "$FILE" | read json

        and if jq -en --argjson json "$json" '$json.type == "chrome_tab"' >/dev/null
            chrome-cli activate -t "$(jq -nr --argjson json "$json" '$json.tab_id')"
            yabai -m window --focus "$(jq -nr --argjson json "$json" '$json.window_id')"
        else if jq -en --argjson json "$json" '$json.type == "yabai_chrome_tab"' >/dev/null
            yabai -m window --focus "$(jq -nr --argjson json "$json" '$json.window_id')"
            skhd -k "cmd - $(jq -nr --argjson json "$json" '$json.tab_index')"
        else if jq -en --argjson json "$json" '$json.type == "window"' >/dev/null
            yabai -m window --focus "$(jq -nr --argjson json "$json" '$json.window_id')"
        else
            display-message "Invalid pin"
            return 1
        end
    end
end

complete -c yabai-harpoon -f
complete -c yabai-harpoon -d "mode" -a "add delete edit"
