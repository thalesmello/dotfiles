function yabai-preset
    # We use btt_url to execute some action in order to fill in the gap of workspaces not working by default
    set btt_url 'http://localhost:12000/trigger_action/'
    set preset $argv[1]
    set -e argv[1]

    switch "$preset"
    case "focus-window"
        set direction $argv[1]
        set -e argv[1]
        set winid (yabai -m query --windows --space | jq --arg dir "$direction" '
        def hidden($under; $above):
        ($under.x >= $above.x
        and ($under.x + $under.w) <=($above.x + $above.w)
        and $under.y >= $above.y
        and ($under.y + $under.h) <= ($above.y + $above.h));

        def intersect($u; $a):
        if
                ($u.x >= ($a.x + $a.w)
                or ($u.x + $u.w) <= $a.x
                or ($u.y + $u.h) <= $a.y
                or $u.y >= ($a.y + $a.h)) then empty
        else
                ([$u.x, $a.x] | max) as $x
                | ([$u.y, $a.y] | max) as $y
                | (([$u.x + $u.w, $a.x + $a.w] | min) - $x) as $w
                | (([$u.y + $u.h, $a.y + $a.h] | min) - $y) as $h
                | {$x, $y, $w, $h}
        end;

        def visible_area($under_list; $many):
        $under_list
        | [.[0], .[1:]] as [$under, $tail]
        | if $under == null then 0
        elif ($many | any(hidden($under; .))) then visible_area($tail; $many)
        else (
                [first($many[] | intersect($under; .))] as [$i]
                | $under as $u
                | if $i == null then (($u.w * $u.h) + visible_area($tail; $many))
                else visible_area(([
                        {x: $u.x, y: $u.y, w: ($i.x - $u.x), h: ($i.y - $u.y)},
                        {x: $i.x, y: $u.y, w: $i.w, h: ($i.y - $u.y)},
                        {x: ($i.x + $i.w), y: $u.y, w: ($u.x + $u.w - $i.x - $i.w), h: ($i.y - $u.y)},
                        {x: $u.x, y: $i.y, w: ($i.x - $u.x), h: $i.h},
                        {x: $i.x, y: $i.y, w: $i.w, h: $i.h},
                        {x: ($i.x + $i.w), y: $i.y, w: ($u.x + $u.w - $i.x - $i.w), h: $i.h},
                        {x: $u.x, y: ($i.y + $i.h), w: ($i.x - $u.x), h: ($u.y + $u.h - $i.y - $i.h)},
                        {x: $i.x, y: ($i.y + $i.h), w: $i.w, h: ($u.y + $u.h - $i.y - $i.h)},
                        {x: ($i.x + $i.w), y: ($i.y + $i.h), w: ($u.x + $u.w - $i.x - $i.w), h: ($u.y + $u.h - $i.y - $i.h)}
                ]|map(select((.h>0) and (.w>0)))) + $tail; $many) end
        )
        end;
        .
        | map(select(."is-visible" and (."is-sticky"|not)))
        | reverse
        | with_entries(.value += {z_index: .key} | .key |= "key_\(.)")
        | to_entries
        | map(.value)
        | { under: .[0], many: .[1:] }
        | [recurse({ under: .many[0], many: .many[1:] }; .under != null)]
        | map(.under.visible_area = visible_area([.under.frame + {title: .under.title}]; .many|map(.frame)))
        | map(.under)
        | map(.percentage_visible = (.visible_area / (.frame|.w*.h)))
        | map(select(.percentage_visible > 0.01))
        | (first(.[] | select(."has-focus")) // .[-1]) as {$id, $title, frame: $zero}
        | ($zero |
            if $dir == "east" then {x: (.x + .w), y: (.y/2 + .h/2)}
            elif $dir == "west" then {x: .x, y: (.y/2 + .h/2)}
            elif $dir == "south" then {x: (.x/2 + .w/2), y: (.y + .h)}
            elif $dir == "north" then {x: (.x/2 + .w/2), y: .y}
            end | . + {w: $zero.w, h: $zero.h}) as $zero
        | sort_by(
            if $dir == "east" then [.frame.x + .frame.w, .id]
            elif $dir == "west" then [-.frame.x, -.id]
            elif $dir == "south" then [.frame.y + .frame.h, .id]
            elif $dir == "north" then [-.frame.y, -.id]
            end
        )
        | .[(map(.id) | index($id))+1:]
        | (if ($dir == "east" or $dir == "west") then [2, 1]
        elif ($dir == "north" or $dir == "south") then [1, 2]
        end) as [$x_exp, $y_exp]
        | map(.ref = {

        })
        | map(
        .distance =
            if $dir == "east" then ([.frame.x + .frame.w, .frame.x]|map(.-$zero.x|select(.>0))|min) + ([.frame.y/2 + .frame.h/2 - $zero.y -$zero.h/2, 0]|max)
            elif $dir == "west" then ([.frame.x + .frame.w, .frame.x]|map($zero.x-.|select(.>0))|min) + ([.frame.y/2 + .frame.h/2 - $zero.y - $zero.h/2, 0]|max)
            elif $dir == "south" then ([.frame.x/2 + .frame.w/2 - $zero.x - $zero.w/2, 0]|max) + ([.frame.y + .frame.h, .frame.y]|map(.-$zero.y|select(.>0))|min)
            elif $dir == "north" then ([.frame.x/2 + .frame.w/2 - $zero.x - $zero.w/2, 0]|max) + ([.frame.y + .frame.h, .frame.y]|map($zero.y-.|select(.>0))|min)
            end
        | .x_distance =
            if $dir == "east" then pow([.frame.x + .frame.w, .frame.x]|map(.-$zero.x|select(.>0))|min; 1)
            elif $dir == "west" then pow([.frame.x + .frame.w, .frame.x]|map($zero.x-.|select(.>0))|min; 1)
            elif $dir == "south" then pow(.frame.x/2 + .frame.h/2 - $zero.x; 2)
            elif $dir == "north" then pow(.frame.y/2 + .frame.w/2 - $zero.y; 2)
            end
        |.y_distance =
            if $dir == "east" then pow(.frame.y/2 + .frame.h/2 - $zero.y; 2)
            elif $dir == "west" then pow(.frame.y/2 + .frame.h/2 - $zero.y; 2)
            elif $dir == "south" then pow([.frame.y + .frame.h, .frame.y]|map(.-$zero.y|select(.>0))|min; 1)
            elif $dir == "north" then pow([.frame.y + .frame.h, .frame.y]|map($zero.y-.|select(.>0))|min; 1)
            end
        )
        | sort_by([.distance, -.z_index])
        | map(.zero = $zero)
        | map(debug(. | {title, zero, distance, frame, x_distance, y_distance, z_index}))
        | first.id'
        )
        yabai -m window "$winid" --focus
    case "focus-window-classic"
        set direction $argv[1]
        set -e argv[1]
        set winid (yabai -m query --windows --space | jq -e --arg direction "$direction" '.
        | (.[] | select(."has-focus")) as {$id, $app, frame: $zero}
        | map(select(."is-visible" and (."is-sticky"|not)) | .zero = $zero)
        | map(.frame |= . + {distance: (pow(.x - $zero.x; 2) + pow(.y - $zero.y; 2)), angle: atan2(-.y + $zero.y; .x - $zero.x)})
        | {
        east: {lt: (3.14/4), gte: (-3.14/4)},
        north: {lt: (3*3.14/4), gte: (3.14/4)},
        west: {lt: (5*3.14/4), gte: (3*3.14/4), shiftnegative: true},
        south: {gte: (-3*3.14/4), lt: (-3.14/4)}}[$direction] as $filter
        | map(.frame.angle |= if $filter.shiftnegative and . < 0 then (. + 2*3.14) else . end)
        | map(select(.frame.angle >= $filter.gte and .frame.angle < $filter.lt and .id != $id))
        | sort_by(.frame.distance)
        | first
        | .id')

        yabai -m window "$winid" --focus
    case "focus-space"
        set space $argv[1]
        set -e argv[1]

        if contains "$space" "next" "prev" "recent"
            set space (yabai -m query --spaces --space "$space" | jq .index)
        end

        set json (jq -nc --argjson spc "$space" '{"BTTPredefinedActionType":(206 + $spc)}')
        set json (string escape --style=url "$json")
        curl -G "$btt_url" -d "json=$json"
    case "move-window-to-space"
        set space $argv[1]
        set -e argv[1]

        if contains "$space" "next" "prev" "recent"
            set space (yabai -m query --spaces --space "$space" | jq .index)
        end

        set json (jq -nc --argjson spc "$space" '{"BTTPredefinedActionType":(215 + $spc + if $spc >= 6 then 1 else 0 end)}')
        set json (string escape --style=url "$json")

        curl -G "$btt_url" -d "json=$json"
    case "focus-window-in-stack"
        set stack $argv[1]
        set -e argv[1]

        if contains "$stack" "next" "prev" "recent" "first" "last"
            set stack (yabai -m query --windows --window "stack.$stack" | jq -e '."stack-index"')
        end

        if not test -n "$stack" -a "$stack" -gt 0
            return 1
        end

        set last (yabai -m query --windows --window "stack.last" | jq -e '."stack-index"')
        yabai -m window --focus "stack.$stack"
        display-message "Stack $stack / $last"
    case "focus-window-in-space"
        argparse -i \
            'floating-only=?' \
            -- $argv

        set window $argv[1]
        set -e argv[1]

        if not contains "$window" "next" "prev" "first" "last"
            echoerr "Invalid argument: $window"
            return 1
        end

        set floating_only (test -n "$_flag_floating_only" && echo "true" || echo "false")
        set is_layout_float (yabai-preset is-space-float-layout && echo true || echo false)

        yabai -m query --windows --space | jq -er --arg window "$window" --argjson floating_only "$floating_only" --argjson is_layout_float "$is_layout_float" '.
        | map(select(."is-visible" and (."is-sticky"|not) and (if $is_layout_float then true elif $floating_only then ."split-type" == "none" and ."is-floating" else true end)))
            | (first(.[] | select(."has-focus")) // .[0]).id as $focus
            | sort_by([
                # Floating windows appear last
                if ."split-type" == "none" and ."is-floating" then 2
                else 1 end,
                .frame.x,
                .frame.y,
                ."stack-index",
                .id
            ])
            | (map(.id) | index($focus)) as $pos
            | ({first: 0, last: (length - 1), prev: ([0, $pos - 1]|max), next: ([length - 1, $pos + 1]|min)}[$window]) as $window_pos
            | "\(.[$window_pos].id):\($window_pos+1):\(length)" ' | read -d: window window_pos total

        yabai -m window --focus "$window"

        if set -q $_flag_floating_only
            display-message "Floating $window_pos / $total"
        else
            display-message "Windows $window_pos / $total"
        end
    case "focus-floating-window-in-space"
        set window $argv[1]
        set -e argv[1]

        if not contains "$window" "next" "prev" "first" "last"
            echoerr "Invalid argument: $window"
            return 1
        end

        yabai -m query --windows --space | jq -er --arg window "$window" '.
            | map(select(."is-visible" and (."is-sticky"|not) and ."split-type" == "none" and ."is-floating"))
            | (first(.[] | select(."has-focus")) // .[0]).id as $focus
            | sort_by([.frame.x, .frame.y, .id])
            | (map(.id) | index($focus)) as $pos
            | ({first: 0, last: (length - 1), prev: ([0, $pos - 1]|max), next: ([length - 1, $pos + 1]|min)}[$window]) as $window_pos
            | "\(.[$window_pos].id):\($window_pos+1):\(length)" ' | read -d: window window_pos total

        yabai -m window --focus "$window"
        display-message "Windows $window_pos / $total"
    case "move-window-in-stack"
        set stack $argv[1]
        set -e argv[1]

        if contains "$stack" "next" "prev" "recent" "first" "last"
            set stack (yabai -m query --windows --window "stack.$stack" | jq -e '."stack-index"')
        end

        if not test -n "$stack" -a "$stack" -gt 0
            return
        end

        set last (yabai -m query --windows --window "stack.last" | jq -e '."stack-index"')
        yabai -m window --swap "stack.$stack"
        yabai -m window --focus "stack.$stack"
        display-message "Stack $stack / $last"
    case "focus-display-with-fallback"
        set display $argv[1]
        set -e argv[1]

        if test "$display" = north -o "$display" = west
            set fallback prev
        else
            set fallback next
        end

        yabai -m display --focus "$display" || yabai -m display --focus "$fallback"
    case "move-window-to-display-with-fallback"
        # Yabai needs SPI for this, so we use btt
        # btt only supports next monitor, so we focus next with yabai regardless

        set win (yabai -m query --windows --window | jq '.id')
        set fallback next
        set json '{"BTTPredefinedActionType" : 98}'
        set json (string escape --style=url "$json")

        if yabai-preset is-window-floating
            curl -G "$btt_url" -d "json=$json"
            yabai -m window --focus "$win"
        else
            yabai -m window "$win" --toggle float
            yabai -m window --focus "$win"
            curl -G "$btt_url" -d "json=$json"
            yabai -m window "$win" --toggle float
        end
    case "stack-or-warp-window"
        set direction $argv[1]
        set -e argv[1]

        if yabai -m query --windows --window | jq -e '."stack-index" > 0'
            yabai -m window --warp "$direction"
        else
            yabai -m window --stack "$direction"
        end
    case "stack-windows-in-space"
        set query '.
            | map(select(."is-visible" and (."is-sticky"|not)))
            | (first(.[] | select(."has-focus")) // .[0]) as $focus
            | [$focus.id] + map(select($focus.id != .id) | .id)
            | .[]'
        set windows (yabai -m query --windows --space | jq -er "$query")

        set current $windows[1]
        yabai -m window "$current" (printf "--stack\n%s\n" $windows[2..])

        # Hack: When using two monitors, some windows down in the tree get "pushed"
        # to the other monitor and might not be properly captured by the query command,
        # so we need to do a second passing
        set second_passing (yabai -m query --windows --space | jq -er "$query")

        for window in $second_passing
            if not contains "$window" $windows
                yabai -m window "$current" --stack "$window"
            end
        end

        display-message "$(count $second_passing) windows stacked"
    case "stack-after-nth-window"
        set nth $argv[1]
        set -e argv[1]

        echo $nth
        set windows (yabai -m query --windows --space | jq -er --argjson nth "$nth" '.
            | map(select(."is-visible" and (."is-sticky"|not)))
            | .[$nth-1:]
            | .[].id')

        set nth_window $windows[1]
        yabai -m window "$nth_window" (printf "--stack\n%s\n" $windows[2..])
        display-message "$(count $windows) windows stacked"
    case "unstack-window"
        set direction $argv[1]
        set -e argv[1]

        yabai -m window --insert "$direction" --toggle float --toggle float
    case "arrange-spaces"
        argparse -i \
            'a/app=+' \
            'w/window=+' \
            -- $argv

        for line in "app:"$_flag_app "title:"$_flag_window
            echo $line | read -l -d: format space filter

            for line2 in (yabai -m query --windows | jq -er --arg format "$format" --argjson space "$space" '.[] | select(.space != $space) | "\(.id):\(.[$format]):"' | string match -er ":$filter:")
                echo $line2 | read -l -d: window __

                set -a specs "$space:$window"
            end
        end


        for line in $specs
            echo $line | read -d: space window
            yabai -m window "$window" --focus
            sleep 0.5
            yabai-preset move-window-to-space "$space"
        end

    case "get-pin-json"
        set window (yabai -m query --windows --space | jq  'first(.[] | select(."has-focus"))')

        if jq -en --argjson window "$window" '$window.app == "Google Chrome"' >/dev/null
            set chrome_tab (env OUTPUT_FORMAT=json chrome-cli info | string collect)
            # env OUTPUT_FORMAT=json chrome-cli info \
            # | jq -r '"\(.windowId):\(.id)"' \
            # | read -d: -l chrome_window_id tab_id

            # The following is a prototyped solution using cmd - index to select the tab
            # Commented out because it doesn't seem very fast
            #set tab_index (env OUTPUT_FORMAT=json chrome-cli list tabs -w "$chrome_window_id" \
            #|  jq -r --arg tab_id "$tab_id" '.tabs | map(.id) | index($tab_id) + 1')
            #
            #and if test "$tab_index" -le 8
            #    # Index is <= 8 then it's faster to use cmd + index
            #    set json (jq -n --argjson tab_index "$tab_index" --argjson window "$window" '{type: "yabai_chrome_tab", tab_index: $tab_index, window_id: $window.id}')
            #else
            #    set json (jq -n --arg tab_id "$tab_id" --argjson window "$window" '{type: "chrome_tab", tab_id: $tab_id, window_id: $window.id}')
            #end

            set json (jq -n --argjson chrome_tab "$chrome_tab" --argjson window "$window" '{app: $window.app, title: $chrome_tab.title, type: "chrome_tab", uuid: ({chrome_tab: $chrome_tab.id} | @base64), tab_id: $chrome_tab.id, tab_window_id: $chrome_tab.windowId, url: $chrome_tab.url}')
        else
            set json (jq -n --argjson window "$window" '{app: $window.app,  title: $window.title, type: "window", uuid: ({window: $window.id} | @base64), window_id: $window.id}')
        end

        echo "$json"
    case "pin-object"
        set position $argv[1]
        set -e argv[1]

        set json (yabai-preset get-pin-json)
        set type (jq -n --argjson json "$json" '.type')

        mkdir -p "/tmp/yabai-preset/pins/"
        echo $json > "/tmp/yabai-preset/pins/$position.json"
        display-message "Pin $type $position"
    case "focus-pinned-object"
        set position $argv[1]
        set -e argv[1]

        yabai-preset focus-pin-json < "/tmp/yabai-preset/pins/$position.json"
    case "focus-pin-json"
        read json

        set type (jq -n --argjson json "$json" '$json.type')

        set has_failed 0

        if jq -en --argjson type "$type" '$type == "chrome_tab"' >/dev/null
            chrome-cli activate -t "$(jq -nr --argjson json "$json" '$json.tab_id')"
            and chrome-preset focus-window "$(jq -nr --argjson json "$json" '$json.tab_window_id')"
            chrome-preset check-tab-id "$(jq -nr --argjson json "$json" '$json.tab_id')"
            or chrome-preset open-url --newtab "$(jq -nr --argjson json "$json" '$json.url')"
            or set has_failed 1
        else if jq -en --argjson type "$type" '$type == "chrome_search_tab"' >/dev/null
            chrome-cli activate -t "$(jq -nr --argjson json "$json" '$json.tab_id')"
            and chrome-preset focus-or-open-url "$(jq -nr --argjson json "$json" '$json.uuid')"
            or set has_failed 1
        else if jq -en --argjson type "$type" '$type == "window"' >/dev/null
            yabai -m window --focus "$(jq -nr --argjson json "$json" '$json.window_id')"
            or set has_failed 1
        else
            set type unkown_pin
            set has_failed 1
        end

        echo $has_failed
        if test has_failed = 1
            display-message "Load $type failed"
            return 1
        end
    case "is-window-floating"
        set window $argv[1]; set -e argv[1]

        yabai -m query --windows --window "$window" \
        | jq -r '.space, ."is-floating"' \
        | read --line space is_floating

        if yabai -m query --spaces --space "$space" | jq -e '.type == "float"' >/dev/null
            return 0
        end

        test "$is_floating" = true
        or return 1
    case "is-space-float-layout"
        set space $argv[1]
        set -e argv[1]

        yabai -m query --spaces --space "$space" | jq -e '.type == "float"' >/dev/null
        or return 1
    case "is-window-fullscreen"
        set window $argv[1]
        set -e argv[1]

        if test -z "$window"
            set window (yabai -m query --windows | jq -r 'first(.[] | select(."has-focus")) | .id')
        end

        yabai -m query --windows --window "$window" | jq -r '.frame.w, .frame.h, .display' | read --line w h display
        yabai -m query --displays --display "$display" | jq -r '.frame | .w, .h' | read --line display_w display_h

        echo "$(math "0.9 * $display_w")" -le "$w" -a "$(math "0.9 * $display_h")" -le "$h"
        test "$(math "0.9 * $display_w")" -le "$w" -a "$(math "0.9 * $display_h")" -le "$h"
        or return 1
    case "toggle-window-zoom-or-fullscreen"
        set window $argv[1]
        set -e argv[1]

        if test -z "$window"
            set window (yabai -m query --windows | jq -r 'first(.[] | select(."has-focus")) | .id')
        end

        if yabai-preset is-window-floating "$window"
            if yabai-preset is-window-fullscreen "$window"
                yabai-preset restore-window-position
            else
                yabai-preset store-window-position
                yabai -m window "$window" --grid "1:1:0:0:1:1"
            end
        else
            yabai -m window "$window" --toggle zoom-fullscreen
        end
    case "toggle-monocle-mode"
        if yabai -m query --windows --window | jq -re '."has-fullscreen-zoom"' > /dev/null
            display-message "Exit Monocle"
            set fullscreen true
        else
            display-message "Enter Monocle"
            set fullscreen false
        end

        set windows (yabai -m query --windows --space | jq -re --argjson fullscreen "$fullscreen" '
            .[]
            | debug($fullscreen)
            | select(
                ."is-visible"
                and (."is-sticky" | not)
                and (."stack-index" <= 1)
                and (."has-fullscreen-zoom" == $fullscreen))
            | .id')

        for window in $windows
            echo window "$window"
            yabai -m window "$window" --toggle zoom-fullscreen
        end
    case "toggle-yabai"
        yabai --stop-service
        and display-message "Yabai Stopped"
        or begin
            yabai --start-service
            and display-message "Yabai Started"
        end

    case "store-window-position"
        set winid $argv[1]; set -e argv[1]

        set window (yabai -m query --windows --window "$window")

        yabai-preset is-window-floating "$winid" || return 1
        yabai-preset is-window-fullscreen "$winid" && return 1

        set frame (jq -enc --argjson window "$window" '$window | .frame')
        set winid (jq -nr --argjson window "$window" '$window.id')

        mkdir -p "/tmp/yabai-preset/window-positions/"
        echo "$frame" > "/tmp/yabai-preset/window-positions/$winid.json"
    case "restore-window-position"
        set winid $argv[1]; set -e argv[1]

        set winid (default "$winid" "$(yabai -m query --windows --window | jq '.id')")

        jq -erc '.x, .y, .w, .h | floor' < "/tmp/yabai-preset/window-positions/$winid.json" \
        | read --line x y w h

        and yabai -m window "$winid" --move "abs:$x:$y"
        and yabai -m window "$winid" --resize "abs:$w:$h"
    case "print-window-mode"
        set winid $argv[1]; set -e argv[1]
        yabai -m query --windows --window | jq -r '.id, ."stack-index", ."has-fullscreen-zoom"' | read --line id stack_index has_zoom

        if yabai-preset is-window-floating
            echo "float"
        else if test "$stack_index" -gt 0
            yabai -m query --windows --window stack.last | jq -r '."stack-index"' | read --line stack_count
            echo "stack $stack_index/$stack_count"
        else if test "$has_zoom" = true
            echo "zoom"
        else
            echo "tile"
        end
    case "print-yabai-widget"
        yabai -m query --spaces \
        | jq -r 'length, (map(select(."has-focus"))[0] | .index, .type)' \
        | read --line spaces_count space_number space_mode

        set window_mode "$(yabai-preset print-window-mode)"

        echo "$space_mode:$space_number/$spaces_count ($window_mode)"
    case "unstacked-swap-largest"
        set focus_id (yabai -m query --windows --window | jq -r '.id')

        if yabai -m query --windows --window | jq -e '."stack-index" > 0'
            set pending_stack_id (yabai -m query --windows --window largest | jq -r '.id')
            yabai-preset unstack-window east
        end

        yabai -m window --swap largest

        if set -q pending_stack_id
            yabai -m window --focus "$pending_stack_id"
            yabai -m window west --stack "$pending_stack_id"
            yabai -m window --focus "$pending_stack_id"
            yabai -m window --focus "$focus_id"
        end
    case "*"
        return 1
    end
end
