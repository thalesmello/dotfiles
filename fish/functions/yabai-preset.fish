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
        | { under: .[0], many: .[1:] }
        | [recurse({ under: .many[0], many: .many[1:] }; .under != null)]
        | map(.under.visible_area = visible_area([.under.frame + {title: .under.title}]; .many|map(.frame)))
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

        if contains "$space" "next" "prev" "recent"
            set space (yabai -m query --spaces --space "$space" | jq .index)
        end

        set json (jq -nc --argjson spc "$space" '{"BTTPredefinedActionType":(206 + $spc)}')
        set json (string escape --style=url "$json")
        curl -G "$btt_url" -d "json=$json"
        yabai-preset display-message "Space $space"
    else if test "$preset" = "move-window-to-space"
        set space $argv[1]
        set -e argv[1]

        if contains "$space" "next" "prev" "recent"
            set space (yabai -m query --spaces --space "$space" | jq .index)
        end

        set json (jq -nc --argjson spc "$space" '{"BTTPredefinedActionType":(215 + $spc)}')
        set json (string escape --style=url "$json")

        curl -G "$btt_url" -d "json=$json"
        yabai-preset display-message "Space $space"
    else if test "$preset" = "focus-window-in-stack"
        set stack $argv[1]
        set -e argv[1]

        if contains "$stack" "next" "prev" "recent" "first" "last"
            set stack (yabai -m query --windows --window "stack.$stack" | jq -e '."stack-index"')
        end

        if not test -n "$stack" -a "$stack" -gt 0
            return
        end

        set last (yabai -m query --windows --window "stack.last" | jq -e '."stack-index"')
        yabai -m window --focus "stack.$stack"
        yabai-preset display-message "Stack $stack / $last"
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
        yabai-preset display-message "Stack $stack / $last"
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
    else if test "$preset" = "display-message"
        set message $argv[1]
        set -e argv[1]

        set json (jq -n --arg message "$message" '{
    "BTTPredefinedActionType" : 254,
    "BTTHUDActionConfiguration" : "{\\"BTTActionHUDBlur\\":true,\\"BTTActionHUDBackground\\":\\"0.000000, 0.000000, 0.000000, 0.000000\\",\\"BTTIconConfigImageHeight\\":100,\\"BTTActionHUDPosition\\":0,\\"BTTActionHUDDetail\\":\\"\\",\\"BTTActionHUDDuration\\":0.15000000596046448,\\"BTTActionHUDDisplayToUse\\":0,\\"BTTIconConfigImageWidth\\":100,\\"BTTActionHUDSlideDirection\\":0,\\"BTTActionHUDHideWhenOtherHUDAppears\\":false,\\"BTTActionHUDWidth\\":220,\\"BTTActionHUDAttributedTitle\\":\\"{\\\\\\\\rtf1\\\\\\\\ansi\\\\\\\\ansicpg1252\\\\\\\\cocoartf2822\\\\n\\\\\\\\cocoatextscaling0\\\\\\\\cocoaplatform0{\\\\\\\\fonttbl\\\\\\\\f0\\\\\\\\fswiss\\\\\\\\fcharset0 Helvetica-Bold;}\\\\n{\\\\\\\\colortbl;\\\\\\\\red255\\\\\\\\green255\\\\\\\\blue255;\\\\\\\\red0\\\\\\\\green0\\\\\\\\blue0;}\\\\n{\\\\\\\\*\\\\\\\\expandedcolortbl;;\\\\\\\\cssrgb\\\\\\\\c0\\\\\\\\c0\\\\\\\\c0\\\\\\\\c84706\\\\\\\\cname labelColor;}\\\\n\\\\\\\\pard\\\\\\\\tx560\\\\\\\\tx1120\\\\\\\\tx1680\\\\\\\\tx2240\\\\\\\\tx2800\\\\\\\\tx3360\\\\\\\\tx3920\\\\\\\\tx4480\\\\\\\\tx5040\\\\\\\\tx5600\\\\\\\\tx6160\\\\\\\\tx6720\\\\\\\\pardirnatural\\\\\\\\qc\\\\\\\\partightenfactor0\\\\n\\\\n\\\\\\\\f0\\\\\\\\b\\\\\\\\fs80 \\\\\\\\cf2 \($message)}\\",\\"BTTActionHUDBorderWidth\\":0,\\"BTTActionHUDTitle\\":\\"\\",\\"BTTIconConfigIconType\\":2,\\"BTTActionHUDHeight\\":220}",
  }')

        set json (string escape --style=url "$json")
        curl -G "$btt_url" -d "json=$json"

    else if false
    end

end


