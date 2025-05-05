function yabai-preset
    # We use btt_url to execute some action in order to fill in the gap of workspaces not working by default
    set btt_url 'http://localhost:12000/trigger_action/'
    set preset $argv[1]
    set -e argv[1]

    if test "$preset" = "focus-window"
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
    else if test "$preset" = "focus-window-classic"
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
    else if test "$preset" = "focus-space"
        set space $argv[1]
        set -e argv[1]

        if contains "$space" "next" "prev" "recent"
            set space (yabai -m query --spaces --space "$space" | jq .index)
        end

        set json (jq -nc --argjson spc "$space" '{"BTTPredefinedActionType":(206 + $spc)}')
        set json (string escape --style=url "$json")
        curl -G "$btt_url" -d "json=$json"
    else if test "$preset" = "move-window-to-space"
        set space $argv[1]
        set -e argv[1]

        if contains "$space" "next" "prev" "recent"
            set space (yabai -m query --spaces --space "$space" | jq .index)
        end

        set json (jq -nc --argjson spc "$space" '{"BTTPredefinedActionType":(215 + $spc + if $spc >= 6 then 1 else 0 end)}')
        set json (string escape --style=url "$json")

        curl -G "$btt_url" -d "json=$json"
    else if test "$preset" = "focus-window-in-stack"
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
    else if test "$preset" = "focus-window-in-space"
        argparse -i \
            'floating-only=?' \
            -- $argv

        set window $argv[1]
        set -e argv[1]

        if not contains "$window" "next" "prev" "first" "last"
            echoerr "Invalid argument: $window"
            return 1
        end

        set floating_only (set -q _flag_floating_only && echo "true" || echo "false")

        yabai -m query --windows --space | jq -er --arg window "$window" --argjson floating_only "$floating_only" '.
        | map(select(."is-visible" and (."is-sticky"|not) and (if $floating_only then ."split-type" == "none" else true end)))
            | (first(.[] | select(."has-focus")) // .[0]).id as $focus
            | sort_by([
                # Floating windows appear last
                if ."split-type" == "none" then 2
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
    else if test "$preset" = "focus-floating-window-in-space"
        set window $argv[1]
        set -e argv[1]

        if not contains "$window" "next" "prev" "first" "last"
            echoerr "Invalid argument: $window"
            return 1
        end

        yabai -m query --windows --space | jq -er --arg window "$window" '.
            | map(select(."is-visible" and (."is-sticky"|not) and ."split-type" == "none"))
            | (first(.[] | select(."has-focus")) // .[0]).id as $focus
            | sort_by([.frame.x, .frame.y, .id])
            | (map(.id) | index($focus)) as $pos
            | ({first: 0, last: (length - 1), prev: ([0, $pos - 1]|max), next: ([length - 1, $pos + 1]|min)}[$window]) as $window_pos
            | "\(.[$window_pos].id):\($window_pos+1):\(length)" ' | read -d: window window_pos total

        yabai -m window --focus "$window"
        display-message "Windows $window_pos / $total"
    else if test "$preset" = "move-window-in-stack"
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
    else if test "$preset" = "focus-display-with-fallback"
        set display $argv[1]
        set -e argv[1]

        if test "$display" = north -o "$display" = west
            set fallback prev
        else
            set fallback next
        end

        yabai -m display --focus "$display" || yabai -m display --focus "$fallback"
    else if test "$preset" = "move-window-to-display-with-fallback"
        # Yabai needs SPI for this, so we use btt
        # btt only supports next monitor, so we focus next with yabai regardless

        set win (yabai -m query --windows --window | jq '.id')
        set fallback next
        set json '{"BTTPredefinedActionType":47}'
        set json (string escape --style=url "$json")
        curl -G "$btt_url" -d "json=$json"
        yabai -m window "$win" --focus
    else if test "$preset" = "arrange-windows-side-by-side"
        yabai -m query --windows --space | jq 'map(select(."is-visible" and (."is-sticky"|not))) | "\(first(.[] | select(."has-focus") | .id)):\(first(.[] | select(."has-focus"|not) | .id))"'
        yabai -m query --windows --space | jq -r 'map(select(."is-visible" and (."is-sticky"|not))) | "\(first(.[] | select(."has-focus") | .id)):\(first(.[] | select(."has-focus"|not) | .id))"' | read -d: active_win back_win

        yabai -m window "$active_win" --grid "1:2:0:0:1:1"
        yabai -m window "$back_win" --grid "1:2:1:0:1:1"
    else if test "$preset" = "stack-or-warp-window"
        set direction $argv[1]
        set -e argv[1]

        if yabai -m query --windows --window | jq -e '."stack-index" > 0'
            yabai -m window --warp "$direction"
        else
            yabai -m window --stack "$direction"
        end
    else if test "$preset" = "stack-windows-in-space"
        set windows (yabai -m query --windows --space | jq -er '.
            | map(select(."is-visible" and (."is-sticky"|not)))
            | (first(.[] | select(."has-focus")) // .[0]) as $focus
            | [$focus.id] + map(select($focus.id != .id) | .id)
            | .[]')

        set current $windows[1]
        yabai -m window "$current" (printf "--stack\n%s\n" $windows[2..])
        display-message "$(count $windows) windows stacked"
    else if test "$preset" = "unstack-window"
        set direction $argv[1]
        set -e argv[1]

        yabai -m window --insert "$direction" --toggle float --toggle float
    else if test "$preset" = "arrange-spaces"
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

    else if test "$preset" = "pin-object"
        set position $argv[1]
        set -e argv[1]

        set window (yabai -m query --windows --space | jq  'first(.[] | select(."has-focus")) | {app, id}')

        echo $window
        if jq -en --argjson window "$window" 'debug(.) | $window.app == "Google Chrome"'
            set type "tab"
            set json (jq -n --argjson tab "$(env OUTPUT_FORMAT=json chrome-cli info)" --argjson window "$window" '{type: "chrome_tab", tab_id: $tab.id, window_id: $window.id}')
        else
            set type "window"
            set json (jq -n --argjson window "$window" '{type: "window", window_id: $window.id}')
        end

        mkdir -p "/tmp/yabai-preset/pins/"
        echo $json > "/tmp/yabai-preset/pins/$position.json"
        display-message "Pin $type $position"
    else if test "$preset" = "focus-pinned-object"
        set position $argv[1]
        set -e argv[1]

        read json < "/tmp/yabai-preset/pins/$position.json"

        if jq -en --argjson json "$json" '$json.type == "chrome_tab"'
            chrome-cli activate -t "$(jq -nr --argjson json "$json" '$json.tab_id')"
            yabai -m window --focus "$(jq -nr --argjson json "$json" '$json.window_id')"
        else if jq -en --argjson json "$json" '$json.type == "window"'
            yabai -m window --focus "$(jq -nr --argjson json "$json" '$json.window_id')"
        end
    else if false
    end

end


