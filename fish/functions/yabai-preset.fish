function yabai-preset
    set preset $argv[1]
    set -e argv[1]

    if test "$preset" = "focus"
        set direction $argv[1]
        set -e argv[1]
        set winid (yabai -m query --windows | jq -e --arg direction "$direction" '. | map(.frame |= . + {x: (.x/2 + .w/2), y: (.y/2 + .h/2)}) | (.[] | select(."has-focus")) as {$id, $app, frame: $zero}
        | map(select(."is-visible") | .zero = $zero)
        | map(.frame |= . + {distance: (pow(.x - $zero.x; 2) + pow(.y - $zero.y; 2)), angle: atan2(-.y + $zero.y; .x - $zero.x)})
        | {east: {lt: (3.14/4), gte: (-3.14/4)}, north: {lt: (3*3.14/4), gte: (3.14/4)}, west: {lt: (-3*3.14/4), gte: (3*3.14/4)}, south: {gte: (-3*3.14/4), lt: (-3.14/4)}}[$direction] as $filter
        | map(select(.frame.angle >= $filter.gte and .frame.angle < $filter.lt and .id != $id))
        | sort_by(.frame.distance)
        | first
        | .id')

        yabai -m window "$winid" --focus
    else if false
    end

end


