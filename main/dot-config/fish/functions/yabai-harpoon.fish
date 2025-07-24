set FILE "/tmp/yabai-harpoon.json"

function yabai-harpoon
    set mode $argv[1]
    set -e argv[1]

    switch "$mode"
    case "add"
        set pin (yabai-preset get-pin-json)

        and if test ! -e "$FILE"
            yabai-harpoon reset-file
        end

        set json (jq --argjson pin "$pin" '.pins |= ([. + [$pin] | to_entries | unique_by(.value.uuid) | sort_by(.key) | .[] | .value])' < "$FILE" | string collect)

        and echo "$json" > "$FILE"

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

            if test ! -e "$FILE"
                yabai-harpoon reset-file
            end

            set tmpfile (mktemp --suffix ".js")

            and jq -c '.pins[]' < "$FILE" > "$tmpfile"

            set -l modified_before (stat -c %y "$tmpfile")

            neovide "$tmpfile" -- -u NONE &
            echo "$last_pid" > "$TMPDIR/nvim_yabai_harpoon_edit.pid"
            wait
            rm "$TMPDIR/nvim_yabai_harpoon_edit.pid"

            set -l modified_after (stat -c %y "$tmpfile")

            if test "$modified_before" != "$modified_after"
                jq -s '{ pins: [. | to_entries | unique_by(.value.uuid) | sort_by(.key) | .[] | .value] }' < "$tmpfile" > "$FILE"
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
    end
end

complete -c yabai-harpoon -f
complete -c yabai-harpoon -d "mode" -a "add delete edit"
