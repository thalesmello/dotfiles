set FILE "/tmp/yabai-harpoon.json"

function yabai-harpoon
    set mode $argv[1]
    set -e argv[1]

    switch "$mode"
    case "add"
        set pin_json (yabai-preset get-pin-json-prototype)

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
        display-message "Edit Yabai-harpoon"

        if test ! -e "$FILE"
            yabai-harpoon reset-file
        end

        set tmpfile (mktemp --suffix ".js")

        and jq -c '.pins[]' < "$FILE" > "$tmpfile"

        and neovide "$tmpfile" -- -u NONE

        and jq -s '{ pins: . }' < "$tmpfile" > "$FILE"

        and display-message "Updated list"
    case "focus"
        set position $argv[1]
        set -e argv[1]

        if test ! -e "$FILE"
            yabai-harpoon reset-file
        end

        jq -ec --argjson pos "$position" '.pins[$pos - 1]' < "$FILE" | read json
        and echo "$json" | yabai-preset focus-pin-json
    end
end

complete -c yabai-harpoon -f
complete -c yabai-harpoon -d "mode" -a "add delete edit"
