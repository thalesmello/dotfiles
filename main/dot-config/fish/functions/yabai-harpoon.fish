set FILE "/tmp/yabai-harpoon.json"

function yabai-harpoon
    set mode $argv[1]
    set -e argv[1]

    switch "$mode"
    case "add"
        set pin (yabai-preset get-pin-json)

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
    case "edit"
        if pgrep -q -F "$TMPDIR/nvim_yabai_harpoon_edit.pid"
            display-message "Focus Yabai-harpoon"
            osascript -e "tell application \"System Events\" to set frontmost of every process whose unix id is $(cat "$TMPDIR/nvim_yabai_harpoon_edit.pid") to true"
        else
            display-message "Edit Yabai-harpoon"

            set tmpfile (mktemp --suffix ".js")

            and yabai-harpoon get-pins-from-file | yabai-harpoon normalize-pins > "$tmpfile"

            set -l modified_before (stat -c %y "$tmpfile")

            neovide "$tmpfile" -- -u NONE &
            echo "$last_pid" > "$TMPDIR/nvim_yabai_harpoon_edit.pid"
            wait
            rm "$TMPDIR/nvim_yabai_harpoon_edit.pid"

            set -l modified_after (stat -c %y "$tmpfile")

            if test "$modified_before" != "$modified_after"
                yabai-harpoon write-pins-to-file < "$tmpfile"
                display-message "Updated list"
            else
                display-message "Exit Update"
            end
        end;

    case "focus"
        set position $argv[1]
        set -e argv[1]

        if test ! -e "$FILE"
            yabai-harpoon reset-file
        end

        jq -ec --argjson pos "$position" '.pins[$pos - 1]' < "$FILE" | read json
        and echo "$json" | yabai-preset focus-pin-json

    case "get-pins-from-file"
        if test ! -e "$FILE"
            yabai-harpoon reset-file
        end

        jq -c '.pins[]' < "$FILE"
    case "write-pins-to-file"
        jq -s '{ pins: [. | to_entries | unique_by(.value.uuid) | sort_by(.key) | .[] | .value] }' > "$FILE"
    case "normalize-pins"
        set yabai_wins (yabai -m query --windows | jq -c 'map({([.id] | @base64): {title}}) | add')
        set chrome_tabs (env OUTPUT_FORMAT=json chrome-cli list tabs | jq -c '.tabs | map({([.windowId, .id] | @base64): {title}}) | add')

        jq -c --argjson "yabai_wins" "$yabai_wins" --argjson "chrome_tabs" "$chrome_tabs" '
            . + ((($yabai_wins + $chrome_tabs)[.uuid] // {}) | del(.[] | nulls))'
    end
end

complete -c yabai-harpoon -f
complete -c yabai-harpoon -d "mode" -a "add delete edit"
