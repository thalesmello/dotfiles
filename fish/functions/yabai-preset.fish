function yabai-preset
    # We use btt_url to execute some action in order to fill in the gap of workspaces not working by default
    set btt_url 'http://localhost:12000/trigger_action/'
    set preset $argv[1]
    set -e argv[1]

    if test "$preset" = "focus-window"
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

        if test "$space" = next
            set json '{"BTTPredefinedActionType":114}'
        else if test "$space" = prev
            set json '{"BTTPredefinedActionType":113}'
        else if test "$space" = recent
            set spc (yabai -m query --spaces --space recent | jq .index)
            set json (jq -nc --argjson spc "$spc" '{"BTTPredefinedActionType":(206 + $spc)}')
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
        else if test "$space" = recent
            set spc (yabai -m query --spaces --space recent | jq .index)
            set json (jq -nc --argjson spc "$spc" '{"BTTPredefinedActionType":(215 + $spc)}')
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
        # Yabai needs SPI for this, so we use btt
        # btt only supports next monitor, so we focus next with yabai regardless

        set win (yabai -m query --windows --window | jq '.id')
        set fallback next
        set json '{"BTTPredefinedActionType":47}'
        curl "$btt_url" --url-query "json=$json"
        yabai -m window "$win" --focus
    else if test "$preset" = "arrange-windows-side-by-side"
        yabai -m query --windows --space | jq 'map(select(."is-visible" and (."is-sticky"|not))) | "\(first(.[] | select(."has-focus") | .id)):\(first(.[] | select(."has-focus"|not) | .id))"'
        yabai -m query --windows --space | jq -r 'map(select(."is-visible" and (."is-sticky"|not))) | "\(first(.[] | select(."has-focus") | .id)):\(first(.[] | select(."has-focus"|not) | .id))"' | read -d: active_win back_win

        yabai -m window "$active_win" --grid "1:2:0:0:1:1"
        yabai -m window "$back_win" --grid "1:2:1:0:1:1"
    else if false
    end

end


