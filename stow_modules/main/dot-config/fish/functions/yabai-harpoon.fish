set FILE "$HOME/.yabai-harpoon.json"
set STATE "$HOME/.yabai-harpoon-current"
set PINFILE_DIR "$HOME/.local_dotfiles/yabai-harpoon/pinfiles"

# Where dev-preset persists the id of the window holding the devserver session.
# A herdr pin taken in that window records that it WAS the devserver rather than
# the window id alone: the devserver window is recreated (new id) whenever the
# connection is restarted, and this file is the memo of where it went.
set DEVSERVER_WINDOW_ID_FILE "/tmp/dev-preset/session.windowid"

function yabai-harpoon
    set mode $argv[1]
    set -e argv[1]

    switch "$mode"
    case "add"
        # Bail rather than rewrite the pin file with nothing to add: an empty pin
        # only reaches jq below as "invalid JSON text passed to --argjson".
        set pin (yabai-harpoon get-focused-pin-json)
        or begin
            display-message "yabai-harpoon: Could not read focused window"
            return 1
        end

        # write-pins-to-file dedupes by uuid, so re-adding something already
        # pinned is a silent no-op that still reports "Add ... to pin <count>".
        # Say where it already is instead.
        yabai-harpoon get-pins-from-file | jq -rs --argjson pin "$pin" \
            'first(to_entries[] | select(.value.uuid == $pin.uuid) | .key + 1) // "", length' \
            | read --line existing total

        if test -n "$existing"
            display-message "yabai-harpoon: Already exists as pin $existing of $total"
            return 0
        end

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

        if test ! -e "$FILE"
            yabai-harpoon reset-file
        end

        set count (jq '.pins | length' < "$FILE")

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
            case "next" "prev"
                # If the actually-focused window is not the pin we last focused
                # ($current/$STATE), snap back to it instead of advancing. This
                # reintroduces the (expensive) focused-window query, but only for
                # next/prev and only when we have a $current to compare against.
                if test -n "$current"; and not yabai-harpoon focused-matches-pin "$current"
                    set position "$current"
                else if test "$target" = "next"
                    test -n "$current"; and set position (math "$current % $count + 1"); or set position 1
                else
                    test -n "$current"; and set position (math "($current - 2 + $count) % $count + 1"); or set position "$count"
                end
            end
        case '*'
            set position "$target"
        end

        set json (yabai-harpoon get-pin "$position")
        or begin
            display-message "yabai-harpoon: Pin $position inexistant"
            return 1
        end

        # Fire the user feedback and floating-terminal hide concurrently with the
        # (longer) Chrome focus below. Both are shorter than focus-pin-json, so
        # they complete during its wait rather than being orphaned on exit.
        display-message "yabai-harpoon: Focus $position" &
        term-preset hide-floating-terminal &

        if echo $json | yabai-harpoon focus-pin-json
            echo "$position" > "$STATE"
        else
            display-message "yabai-harpoon: Refreshing Pins"
            yabai-harpoon rewrite-pins-in-file
            and yabai-harpoon get-pin "$position" | yabai-harpoon focus-pin-json
            and echo "$position" > "$STATE"
        end
        wait
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
            chrome-preset focus-tab "$_tab_id" "$_tab_window_id"
            or set has_failed 1
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
        case herdr_pane
            echo "$json" | yabai-harpoon focus-herdr-pin
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
        else if test "$window_app" = "Ghostty"; and ghostty-preset is-herdr-zoomed-or-single-surface
            # herdr multiplexes many panes into one window, so a plain `window`
            # pin here would only ever return to "wherever herdr happens to be
            # showing". Pin the PANE instead.
            set -l herdr (yabai-harpoon capture-herdr-pin)
            or return 1

            set -l devserver (yabai-harpoon devserver-window-id)

            set json (jq -n --argjson herdr "$herdr" --argjson window "$window" --arg devserver "$devserver" '
                $herdr + {
                    app: $window.app,
                    title: $herdr.name,
                    window_id: $window.id,
                    window_title: $window.title,
                    # The pane id is only unique within its session.
                    uuid: ({herdr_pane: "\($herdr.session):\($herdr.pane_id)"} | @base64),
                    is_devserver: ($devserver != "" and ($devserver | tonumber) == $window.id),
                }')
        else
            set json (jq -n --argjson window "$window" '{app: $window.app,  title: $window.title, type: "window", uuid: ({window: $window.id} | @base64), window_id: $window.id}')
        end

        echo "$json"
    case "focused-matches-pin"
        # Is the focused window the pin at <position>? Used by next/prev to tell
        # "advance" from "snap back to where we thought we were".
        set -l pin (yabai-harpoon get-pin $argv[1])
        or return 1

        jq -nr --argjson json "$pin" '$json.type, ($json.window_id // ""), ($json.is_devserver // false)' \
            | read --line type pin_window is_devserver

        if test "$type" = herdr_pane
            # Identifying the focused PANE would mean another run-command round
            # trip -- a popup flashing open on every next/prev -- so settle for
            # the window. Being on the wrong pane of the right window still
            # counts as being on the pin, which is the answer next/prev needs.
            if test "$is_devserver" = true
                set -l current (yabai-harpoon devserver-window-id)
                test -n "$current"; and set pin_window "$current"
            end

            test -n "$pin_window"; or return 1
            test "$(yabai-preset get-focused-window-id)" = "$pin_window"
            return
        end

        test "$(yabai-harpoon get-focused-pin-json | jq -r '.uuid')" = "$(jq -nr --argjson json "$pin" '$json.uuid')"
    case "devserver-window-id"
        # The window id dev-preset last recorded for the devserver session, or
        # nothing. Empty rather than an error when there is no devserver on this
        # machine at all -- the file only exists where dev-preset runs.
        test -e "$DEVSERVER_WINDOW_ID_FILE"; or return 0

        string match -r '\d+' -- (cat "$DEVSERVER_WINDOW_ID_FILE" 2>/dev/null)
        return 0
    case "capture-herdr-pin"
        # Ask the herdr session displayed in the focused window to describe its
        # focused pane, and print that JSON.
        #
        # The session may be running on a devserver over ssh (`herdr --remote`),
        # where its socket is unreachable from here -- so this cannot just call
        # the herdr CLI. execute-herdr-command runs it wherever the SERVER is,
        # over herdr's run-command popup and the clipboard.
        set -l pin (ghostty-preset execute-herdr-command "herdr-preset get-pin-json")
        or begin
            echo "yabai-harpoon: could not read the herdr pin ($pin)" >&2
            return 1
        end

        # Guard against a reply that came back for something else entirely.
        printf '%s' "$pin" | jq -ec 'select(.type == "herdr_pane")'
        or begin
            echo "yabai-harpoon: not a herdr pin: $pin" >&2
            return 1
        end
    case "focus-herdr-pin"
        read json

        jq -nr --argjson json "$json" '
            $json.window_id, $json.window_title, $json.app,
            $json.pane_id, $json.session, ($json.is_devserver // false)
            ' | read --line window_id window_title app pane_id session is_devserver

        # A restarted devserver connection comes back in a NEW window, so the id
        # recorded with the pin is stale by design. dev-preset's memo of where
        # the devserver went is the current answer.
        if test "$is_devserver" = true
            set -l current (yabai-harpoon devserver-window-id)
            test -n "$current"; and set window_id "$current"
        end

        # Window gone? Fall back to another window of the same app showing the
        # same title -- herdr titles itself after the session it is running, so
        # a session reattached in a fresh window is still recognisable.
        set -l windows (yabai-preset query-windows | string collect)
        if not printf '%s' "$windows" | jq -e --argjson id "$window_id" 'any(.[]; .id == $id)' >/dev/null
            set window_id (printf '%s' "$windows" | jq -r --arg app "$app" --arg title "$window_title" \
                'first(.[] | select(.app == $app and .title == $title) | .id) // empty')
        end

        test -n "$window_id"; or begin
            echo "yabai-harpoon: no window left for herdr pane $pane_id" >&2
            return 1
        end

        # --wait-focus: the popup below is driven by synthetic keystrokes, which
        # go to whatever is focused at the time.
        yabai-preset focus-window-id --wait-focus "$window_id"
        or return 1

        # Confirm herdr really is what that window is showing before typing into
        # it. A failure here returns non-zero, which makes `focus` refresh the
        # pins and retry rather than paste a command at some unrelated app.
        ghostty-preset is-herdr-zoomed-or-single-surface
        or begin
            echo "yabai-harpoon: window $window_id is not showing herdr" >&2
            return 1
        end

        # Same round trip as capture-herdr-pin. --session makes herdr-preset
        # refuse if the window has since been pointed at a different session,
        # where this pane id would name something else entirely. @sh because
        # execute-herdr-command hands what it is given to bash.
        set -l focus_cmd (jq -nrj --arg pane "$pane_id" --arg session "$session" \
            '"herdr-preset focus-pane \($pane|@sh) --session \($session|@sh)"')

        set -l out (ghostty-preset execute-herdr-command "$focus_cmd")
        or begin
            echo "yabai-harpoon: could not focus herdr pane $pane_id ($out)" >&2
            return 1
        end
    case "get-pins-from-file"
        if test ! -e "$FILE"
            yabai-harpoon reset-file
        end

        jq -c '.pins[]' < "$FILE"
    case "write-pins-to-file"
        jq -s '{ pins: [. | to_entries | unique_by(.value.uuid) | sort_by(.key) | .[] | .value] }' > "$FILE"
    case "normalize-pins"
        # Read the incoming pins once so we can decide which (slow) data sources
        # we actually need before paying for them. herdr pins are passed through
        # untouched: re-reading one means another run-command round trip, with a
        # popup flashing open, and the pin already carries its own fallbacks (see
        # focus-herdr-pin). A command substitution like
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
