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
        def intersect($under; $above):
        $above |
        [[.x, .y], [.x+.w, .y], [.x, .y+.h], [.x+.w,.y+.h]]
        | map(. as [$x, $y] | {$x, $y})
        | first(.[] | select(
                ($under.x < .x)
                and (.x < $under.x + $under.w)
                and ($under.y < .y)
                and (.y < $under.y + $under.h)));

        def visible_area($under_list; $many):
        $under_list
        | [.[0], .[1:]] as [$under, $tail]
        | debug({$under, $tail, $many})
        | if $under == null then 0
        elif ($many | any(hidden($under; .))) then visible_area($tail; $many)
        else (
                [first($many[] | intersect($under; .))] as [$intersect]
                | if $intersect == null then (($under.w * $under.h) + visible_area($tail; $many))
                else visible_area(([
                        {x: $under.x, y: $under.y, w: ($intersect.x - $under.x), h: ($intersect.y - $under.y)},
                        {x: $intersect.x, y: $under.y, w: ($under.w - $intersect.x + $under.x), h: ($intersect.y - $under.y)},
                        {x: $under.x, y: $intersect.y, w: ($intersect.x - $under.x), h: ($under.h - $intersect.y + $under.y)},
                        {x: $intersect.x, y: $intersect.y, w: ($under.w - $intersect.x + $under.x), h: ($under.h - $intersect.y + $under.y)}
                ]|map(select((.h>0) and (.w>0)))) + $tail; $many) end
        )
        end;
        .
        | map(select(."is-visible" and (."is-sticky"|not)))
        | reverse
        | { under: .[0], many: .[1:] }
        | [recurse({ under: .many[0], many: .many[1:] }; .under != null)]
        | map(.under.visible_area = visible_area([.under.frame]; .many|map(.frame)))
        | map(.under)
        | map(.percentage_visible = (.visible_area / (.frame|.w*.h)))
        | map(select(.percentage_visible > 0.01))
        | (first(.[] | select(."has-focus")) // .[-1]) as {$id, $title, frame: $zero}
        | sort_by(
if $dir == "east" then [.frame.x, .id]
elif $dir == "west" then [-.frame.x, -.id]
elif $dir == "south" then [.frame.y, .id]
elif $dir == "north" then [-.frame.y, -.id]
end
        )
        | .[(map(.id) | index($id))+1:]
        | map(.zero = $zero | .zero_title = $title)
        | map(.distance = 
        if ($dir == "east" or $dir == "west") then ((.frame.x - $zero.x|abs) + pow(.frame.y - $zero.y; 2))
        elif ($dir == "north" or $dir == "south") then ((.frame.y - $zero.y|abs) + pow(.frame.x - $zero.x; 2))
        end
        )
        | sort_by(.distance)
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


