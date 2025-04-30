function yabai-preset
    # We use btt_url to execute some action in order to fill in the gap of workspaces not working by default
    set btt_url 'http://localhost:12000/trigger_action/'
    set preset $argv[1]
    set -e argv[1]

    if test "$preset" = "focus-window"
        set direction $argv[1]
        set -e argv[1]
        set winid (yabai -m query --windows | jq -e --arg direction "$direction" '. | map(.frame |= . + {x: (.x/2 + .w/2), y: (.y/2 + .h/2)}) | (.[] | select(."has-focus")) as {$id, $app, frame: $zero}
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

        if test "$space" = next
            set json '{"BTTPredefinedActionType":114}'
        else if test "$space" = prev
            set json '{"BTTPredefinedActionType":113}'
        else
            set json (jq -nc --argjson spc "$space" '{"BTTPredefinedActionType":(206 + $spc)}')
        end

        curl "$btt_url" --url-query "json=$json"
    else if test "$preset" = "move-window-to-space"
        set space $argv[1]
        set -e argv[1]

        if test "$space" = next
            set json '{"BTTPredefinedActionType":152}'
        else if test "$space" = prev
            set json '{"BTTPredefinedActionType":151}'
        else
            set json (jq -nc --argjson spc "$space" '{"BTTPredefinedActionType":(215 + $spc)}')
        end

        curl "$btt_url" --url-query "json=$json"
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
        set display $argv[1]
        set -e argv[1]

        if test "$display" = north -o "$display" = west
            set fallback prev
        else
            set fallback next
        end

        yabai -m window --display "$display" || yabai -m window --display "$fallback"
        yabai -m display --focus "$display" || yabai -m display --focus "$fallback"
    else if false
    end

end


