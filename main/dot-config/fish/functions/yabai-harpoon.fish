set FILE "$HOME/.yabai-harpoon.json"
set STATE "$HOME/.yabai-harpoon-current"
set PINFILE_DIR "$HOME/.local_dotfiles/yabai-harpoon/pinfiles"

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
    case "focus" "focus-pin"
        # Accepts either a 1-based position (e.g. `focus 2`) or a direction
        # keyword (`first`/`last`/`next`/`prev`).
        set target $argv[1]
        set -e argv[1]

        # --- TIMING DEBUG (remove once benchmarking is done) ---
        # Each lap is ~2ms of `date` overhead itself; compare relative sizes.
        set -g __harpoon_t0 (date +%s%3N)
        set -g __harpoon_t $__harpoon_t0
        function __harpoon_lap
            set -l now (date +%s%3N)
            echo "[harpoon] $argv[1]: "(math $now - $__harpoon_t)"ms" >&2
            set -g __harpoon_t $now
        end

        if test ! -e "$FILE"
            yabai-harpoon reset-file
        end

        set count (jq '.pins | length' < "$FILE")
        __harpoon_lap "read count ($count pins)"

        if test "$count" -eq 0
            display-message "yabai-harpoon: No pins"
            return 1
        end

        # Resolve a direction keyword to a 1-based position. `current` is the pin
        # we last focused, cached in $STATE, which avoids an expensive query of
        # the focused window on every next/prev. A missing/out-of-range value is
        # treated as "not on a pin".
        switch "$target"
        case "first" "last" "next" "prev"
            set current (cat "$STATE" 2>/dev/null)
            if not string match -qr '^[0-9]+$' -- "$current"
                or test "$current" -lt 1 -o "$current" -gt "$count"
                set current ""
            end

            switch "$target"
            case "first"
                set position 1
            case "last"
                set position "$count"
            case "next"
                test -n "$current"; and set position (math "$current % $count + 1"); or set position 1
            case "prev"
                test -n "$current"; and set position (math "($current - 2 + $count) % $count + 1"); or set position "$count"
            end
        case '*'
            set position "$target"
        end
        __harpoon_lap "resolve position ($position)"

        set json (yabai-harpoon get-pin "$position")
        set -l get_pin_status $status
        __harpoon_lap "get-pin"
        test $get_pin_status -eq 0
        and display-message "yabai-harpoon: Focus $position"
        or begin
            display-message "yabai-harpoon: Pin $position inexistant"
            return 1
        end
        __harpoon_lap "display-message"

        iterm-preset hide-floating-terminal
        __harpoon_lap "iterm hide-floating-terminal"
        if echo $json | yabai-harpoon focus-pin-json
            echo "$position" > "$STATE"
        else
            display-message "yabai-harpoon: Refreshing Pins"
            yabai-harpoon rewrite-pins-in-file
            and yabai-harpoon get-pin "$position" | yabai-harpoon focus-pin-json
            and echo "$position" > "$STATE"
        end
        __harpoon_lap "focus-pin-json + state write"
        echo "[harpoon] TOTAL: "(math (date +%s%3N) - $__harpoon_t0)"ms" >&2
        functions -e __harpoon_lap
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
    case "list-pinfiles"
        test -d "$PINFILE_DIR"; or return 0

        for file in "$PINFILE_DIR"/*.json
            test -e "$file"; or continue
            basename "$file" .json
        end
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

        switch "$type"
        case chrome_tab
            jq -nr --argjson json "$json" '$json.tab_id, $json.tab_window_id' | read --line _tab_id _tab_window_id
            # --- TIMING DEBUG (remove once benchmarking is done) ---
            set -l _ft (date +%s%3N)
            chrome-preset focus-tab "$_tab_id" "$_tab_window_id"
            or set has_failed 1
            echo "[harpoon]   chrome-preset focus-tab: "(math (date +%s%3N) - $_ft)"ms" >&2
        case chrome_preset_app
            jq -nr --argjson json "$json" '$json.uuid, $json.url' | read --line app url

            # TODO: profile name needs to be fetched from the json
            # it can be done by checking the name of the window using the yabai -m query subcommand
            chrome-preset alternate-app --minimize --profile "Default" --app "$app" "$url"
        case chrome_search_tab
            jq -nr --argjson json "$json" '$json.tab_id, $json.uuid' | read --line _tab_id _uuid
            chrome-cli activate -t "$_tab_id"
            and chrome-preset focus-or-open-url "$_uuid"
            or set has_failed 1
        case window
            yabai-preset focus-window-id (jq -nr --argjson json "$json" '$json.window_id')
            or set has_failed 1
        case '*'
            set has_failed 1
        end

        if test $has_failed = 1
            return 1
        end
    case "get-focused-pin-json"
        set window (yabai-preset query-windows --window | string collect)
        jq -nr --argjson window "$window" '$window.id, $window.app' | read --line window_id window_app

        if test "$window_app" = "Google Chrome"
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
            set wm_wins (yabai-preset query-windows | string collect)
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

set -l __yabai_harpoon_modes add delete edit focus-pin write-pinfile read-pinfile load-pinfile list-pinfiles edit-pinfiles

complete -c yabai-harpoon -f
complete -c yabai-harpoon -n "not __fish_seen_subcommand_from $__yabai_harpoon_modes" -d "mode" -a "$__yabai_harpoon_modes"
complete -c yabai-harpoon -n "__fish_seen_subcommand_from read-pinfile load-pinfile" -d "pinfile" -a "(yabai-harpoon list-pinfiles)"
