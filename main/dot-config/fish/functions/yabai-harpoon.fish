set FILE "$HOME/.yabai-harpoon.json"
set PINFILE_DIR "$HOME/.local_dotfiles/yabai-harpoon/pinfiles"

function __harpoon_get_focused_window
    if pgrep -xq AeroSpace
        aerospace list-windows --focused --json | jq 'first(.[] | {id: ."window-id", app: ."app-name", title: ."window-title", "has-focus": true})'
    else
        yabai -m query --windows --space | jq 'first(.[] | select(."has-focus"))'
    end | string collect
end

function __harpoon_focus_window_id
    if pgrep -xq AeroSpace
        aerospace focus --window-id $argv[1]
    else
        yabai -m window --focus $argv[1]
    end
end

function __harpoon_get_all_windows
    if pgrep -xq AeroSpace
        aerospace list-windows --all --json | jq '[.[] | {id: ."window-id", app: ."app-name", title: ."window-title"}]'
    else
        yabai -m query --windows
    end | string collect
end

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

        and display-message "yabai-harpoon: Add $type to pin $count_pins"
    case "reset-file"
        echo '{ "pins": [] }' > "$FILE"
    case "delete"
        yabai-harpoon reset-file
        display-message "yabai-harpoon: Delete list"
    case "rewrite-pins-in-file"
        yabai-harpoon get-pins-from-file | yabai-harpoon normalize-pins | yabai-harpoon write-pins-to-file
    case "edit"
        display-message "yabai-harpoon: Edit"

        set tmpfile (mktemp --suffix ".js")

        and yabai-harpoon get-pins-from-file | yabai-harpoon normalize-pins > "$tmpfile"

        set -l modified_before (stat -c %y "$tmpfile")

        neovim-ghost edit --close-minimize-on-cmd-enter "$tmpfile" -c "setlocal nowrap"

        set -l modified_after (stat -c %y "$tmpfile")


        if test "$modified_before" != "$modified_after"
            yabai-harpoon write-pins-to-file < "$tmpfile"
            display-message "yabai-harpoon: Updated list"
        else
            display-message "yabai-harpoon: Exit Update"
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
        and display-message "yabai-harpoon: Focus $position"
        or begin
            display-message "yabai-harpoon: Pin $position inexistant"
            return 1
        end

        echo $json | yabai-harpoon focus-pin-json
        or begin
            display-message "yabai-harpoon: Refreshing Pins"
            yabai-harpoon rewrite-pins-in-file
            and yabai-harpoon get-pin "$position" | yabai-harpoon focus-pin-json
        end
    case "focus-pin"
        set direction $argv[1]
        set -e argv[1]

        if test ! -e "$FILE"
            yabai-harpoon reset-file
        end

        set count (jq '.pins | length' < "$FILE")

        if test "$count" -eq 0
            display-message "yabai-harpoon: No pins"
            return 1
        end

        # Find the 1-based index of the currently focused pin (by uuid). If the
        # focused window isn't pinned, `current` is empty.
        set focused (yabai-harpoon get-focused-pin-json)
        set uuid (jq -nr --argjson focused "$focused" '$focused.uuid')
        set current (jq --arg uuid "$uuid" 'first(.pins | to_entries[] | select(.value.uuid == $uuid) | .key + 1) // empty' < "$FILE")

        switch "$direction"
        case "first"
            set position 1
        case "last"
            set position "$count"
        case "next"
            if test -z "$current"
                set position 1
            else
                set position (math "$current % $count + 1")
            end
        case "prev"
            if test -z "$current"
                set position "$count"
            else
                set position (math "($current - 2 + $count) % $count + 1")
            end
        case "*"
            display-message "yabai-harpoon: Invalid direction $direction"
            return 1
        end

        yabai-harpoon focus "$position"
    case "write-pinfile"
        set pinname $argv[1]
        set -e argv[1]

        mkdir -p "$PINFILE_DIR"
        and cp "$FILE" "$PINFILE_DIR/$pinname.json"
        and display-message "yabai-harpoon: Wrote pinfile $pinname"
        and echo "Wrote pinfile '$pinname' to $PINFILE_DIR/$pinname.json"
    case "read-pinfile"
        set pinname $argv[1]
        set -e argv[1]

        cat "$PINFILE_DIR/$pinname.json"
        return $status
    case "load-pinfile"
        set pinname $argv[1]
        set -e argv[1]

        if test ! -e "$PINFILE_DIR/$pinname.json"
            display-message "yabai-harpoon: Pinfile $pinname inexistant"
            echo "Pinfile '$pinname' not found at $PINFILE_DIR/$pinname.json" >&2
            return 1
        end

        cp "$PINFILE_DIR/$pinname.json" "$FILE"
        and display-message "yabai-harpoon: Loaded pinfile $pinname"
        and echo "Loaded pinfile '$pinname' from $PINFILE_DIR/$pinname.json"
    case "edit-pinfiles"
        mkdir -p "$PINFILE_DIR"
        neovim-ghost edit --no-wait "$PINFILE_DIR/"
    case "focus-pin-json"
        read json

        set type (jq -nr --argjson json "$json" '$json.type')

        set has_failed 0

        if jq -en --arg type "$type" '$type == "chrome_tab"' >/dev/null
            jq -nr --argjson json "$json" '$json.tab_id, $json.tab_window_id' | read --line _tab_id _tab_window_id
            chrome-preset focus-tab "$_tab_id" "$_tab_window_id"
            or set has_failed 1
        else if jq -en --arg type "$type" '$type == "chrome_preset_app"' >/dev/null
            set app (jq -nr --argjson json "$json" '$json.uuid')
            set url (jq -nr --argjson json "$json" '$json.url')

            echo app $app >&2
            echo url $url >&2

            # TODO: profile name needs to be fetched from the json
            # it can be done by checking the name of the window using the yabai -m query subcommand
            chrome-preset alternate-app --minimize --profile "Default" --app "$app" "$url"
        else if jq -en --arg type "$type" '$type == "chrome_search_tab"' >/dev/null
            chrome-cli activate -t "$(jq -nr --argjson json "$json" '$json.tab_id')"
            and chrome-preset focus-or-open-url "$(jq -nr --argjson json "$json" '$json.uuid')"
            or set has_failed 1
        else if jq -en --arg type "$type" '$type == "window"' >/dev/null
            __harpoon_focus_window_id "$(jq -nr --argjson json "$json" '$json.window_id')"
            or set has_failed 1
        else
            set type unkown_pin
            set has_failed 1
        end

        if test $has_failed = 1
            return 1
        end
    case "get-focused-pin-json"
        set window (__harpoon_get_focused_window)
        set window_id (jq -nr --argjson window "$window" '$window.id')

        if jq -en --argjson window "$window" '$window.app == "Google Chrome"' >/dev/null
            set chrome_tab (env OUTPUT_FORMAT=json chrome-cli info | string collect)

            if set appname (chrome-preset get-app-name --window-id "$window_id")
                set json (jq -n --arg appname "$appname" --argjson chrome_tab "$chrome_tab" '{uuid: $appname, url: $chrome_tab.url, type: "chrome_preset_app"}')
            else
                set json (jq -n --argjson chrome_tab "$chrome_tab" --argjson window "$window" '{app: $window.app, title: $chrome_tab.title, type: "chrome_tab", uuid: ({chrome_tab: $chrome_tab.id} | @base64), tab_id: $chrome_tab.id, tab_window_id: $chrome_tab.windowId, url: $chrome_tab.url}')
            end
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
        # Read the incoming pins once so we can decide which (slow) data sources
        # we actually need before paying for them. A command substitution like
        # `(cat)` does NOT inherit a piped function's stdin in fish, so slurp the
        # lines explicitly with `read`.
        set -l pins
        while read -l line
            set -a pins $line
        end

        if test (count $pins) -eq 0
            return 0
        end

        set -l types (printf '%s\n' $pins | jq -r '.type')

        set -l wm_wins '[]'
        if contains -- window $types
            set wm_wins (__harpoon_get_all_windows)
        end

        set -l chrome_tabs '{"tabs":[]}'
        if contains -- chrome_tab $types
            or contains -- chrome_preset_app $types
            or contains -- chrome_search_tab $types
            set chrome_tabs (chrome-preset list-tabs-json | string collect)
        end

        printf '%s\n' $pins | jq -c --argjson "wm_wins" "$wm_wins" --argjson "chrome_tabs" "$chrome_tabs" '
            ($wm_wins | map({({window: .id} | @base64): {title}}) | add) as $wm_registry
            | ($chrome_tabs | .tabs | map({({chrome_tab: .id} | @base64): {title, tab_window_id: .windowId, url}}) | add) as $chrome_registry
            | ($chrome_tabs | .tabs | map({(.url): {title, tab_window_id: .windowId, tab_id: .id, uuid: ({chrome_tab: .id} | @base64), url: .url, type: "chrome_tab"}}) | add) as $chrome_urls
            | $wm_registry + $chrome_registry as $registry
            | if .type == "chrome_tab" or .type == "window" then try (. + ($registry[.uuid] // $chrome_urls[.url]? // error(.)))
                catch try (
                        if .type == "chrome_tab" then
                            # {"uuid": .url, type: "chrome_search_tab"}
                            {"uuid": (.url|@uri)[:100], type: "chrome_preset_app", url}
                        elif .type == "chrome_preset_app" then
                            .
                        elif .type == "chrome_search_tab" then
                            $chrome_urls[.uuid] // .
                        else error(.) end
                    )
                    catch {type: "window_not_found"}
            else . end
            '
    end
end

complete -c yabai-harpoon -f
complete -c yabai-harpoon -d "mode" -a "add delete edit focus-pin write-pinfile read-pinfile load-pinfile edit-pinfiles"
