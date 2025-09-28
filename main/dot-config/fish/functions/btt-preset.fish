function btt-preset
    set preset $argv[1]
    set -e argv[1]
    set btt_url 'http://localhost:12000/'

    switch "$preset"
    case "trigger-action"
        set json $argv[1]
        set -e argv[1]

        set json (string escape --style=url "$json")
        curl -sSG "$btt_url""trigger_action/" -d "json=$json"
    case "get-string-variable"
        set var $argv[1]
        set -e argv[1]

        set var (string escape --style=url "$var")

        curl -sSG "$btt_url""get_string_variable/" -d "variableName=$var"
    case "get-number-variable"
        set var $argv[1]
        set -e argv[1]

        set var (string escape --style=url "$var")

        curl -SG "$btt_url""get_number_variable/" -d "variableName=$var"
    case "focus-space"
        set space $argv[1]
        set -sSe argv[1]

        set json (jq -nc --argjson spc "$space" '{"BTTPredefinedActionType":(206 + $spc)}')

        btt-preset trigger-action "$json"
    case "move-window-to-space"
        set space $argv[1]
        set -e argv[1]

        set json (jq -nc --argjson spc "$space" '{"BTTPredefinedActionType":(215 + $spc + if $spc >= 6 then 1 else 0 end)}')

        btt-preset trigger-action "$json"
    case "move-window-to-next-display"
        set json (jq -nc '{"BTTPredefinedActionType" : 98}')
        btt-preset trigger-action "$json"
    case "restart-btt"
        set json (jq -nc '{"BTTPredefinedActionType" : 55}')
        btt-preset trigger-action "$json"
    case "display-message"
        argparse duration= -- $argv
        or return 1

        set message $argv[1]
        set -e argv[1]

        set duration (default "$_flag_duration" 0.15)

        set json "$(jq -n --arg message "$message" '{
          "BTTPredefinedActionType": 254,
          "BTTHUDActionConfiguration": {
            "BTTActionHUDBlur": true,
            "BTTActionHUDBackground": "0.000000, 0.000000, 0.000000, 0.000000",
            "BTTIconConfigImageHeight": 100,
            "BTTActionHUDPosition": 0,
            "BTTActionHUDDetail": "",
            "BTTActionHUDDuration": '$duration',
            "BTTActionHUDDisplayToUse": 0,
            "BTTIconConfigImageWidth": 100,
            "BTTActionHUDSlideDirection": 0,
            "BTTActionHUDHideWhenOtherHUDAppears": false,
            "BTTActionHUDWidth": 220,
            "BTTActionHUDAttributedTitle": "{\\\\rtf1\\\\ansi\\\\ansicpg1252\\\\cocoartf2822\\n\\\\cocoatextscaling0\\\\cocoaplatform0{\\\\fonttbl\\\\f0\\\\fswiss\\\\fcharset0 Helvetica-Bold;}\\n{\\\\colortbl;\\\\red255\\\\green255\\\\blue255;\\\\red0\\\\green0\\\\blue0;}\\n{\\\\*\\\\expandedcolortbl;;\\\\cssrgb\\\\c0\\\\c0\\\\c0\\\\c84706\\\\cname labelColor;}\\n\\\\pard\\\\tx560\\\\tx1120\\\\tx1680\\\\tx2240\\\\tx2800\\\\tx3360\\\\tx3920\\\\tx4480\\\\tx5040\\\\tx5600\\\\tx6160\\\\tx6720\\\\pardirnatural\\\\qc\\\\partightenfactor0\\n\\n\\\\f0\\\\b\\\\fs80 \\\\cf2 \\($message)}",
            "BTTActionHUDBorderWidth": 0,
            "BTTActionHUDTitle": "",
            "BTTIconConfigIconType": 2,
            "BTTActionHUDHeight": 220
          }
        }')"

        echo "$json"
        btt-preset trigger-action "$json"
    case "trigger-menu-bar"
        set path $argv[1]
        set -e argv[1]

        set json "$(jq -n --arg path "$path" '{
            "BTTPredefinedActionType" : 124,
            "BTTMenubarPath" : $path,
        }')"

        btt-preset trigger-action "$json"
    case "print-app-path"
        set app $argv[1]
        set -e argv[1]

        osascript -e "POSIX path of (path to application \"$app\")"
    case "show-or-hide-app"
        argparse only-show only-hide -- $argv
        or return 1

        set only_show (count $_flag_only_show)
        set only_hide (count $_flag_only_hide)

        set app $argv[1]
        set -e argv[1]

        echo $only_hide

        set json "$(jq -n --arg app "$app" \
            --argjson only_hide "$only_hide" \
            --argjson only_show "$only_show" '
        {
            "BTTActionCategory" : 0,
            "BTTIsPureAction" : true,
            "BTTPredefinedActionType" : 177,
            "BTTPredefinedActionName" : "Show  or  Hide Specific Application",
            "BTTAppToShowOrHide" : $app,
            "BTTShowHideAppConfig" : {
                "BTTShowHideSpecificAppMoveToSpace":"BTTShowHideSpecificAppNoSpaceChange",
                "BTTShowHideSpecificAppOnlyShow": ($only_show > 0),
                "BTTShowHideSpecificAppOnlyHide": ($only_hide > 0),
                "BTTShowHideSpecificAffectedWindow":"BTTShowHideSpecificAppAffectLastUsedWindow",
                "BTTShowHideSpecificMinimizeInstead":false,
                "BTTShowHideSpecificAppRegex":"",
                "BTTShowHideSpecificAppOnlyTreatActiveAsVisible":true,
                "BTTShowHideSpecificAppOnlyIfRunning":false,
                "BTTShowHideSpecificAppCMDN":false,
                "BTTShowHideSpecificAppMoveToCurrentSpace":false,
                "BTTShowHideSpecificAppMoveAllToCurrentSpace":false
            } | @json,
            "BTTEnabled2" : 1,
            "BTTOrder" : 0
        }
        ')"

        btt-preset trigger-action "$json"
    case "trigger-named-trigger"
        set trigger $argv[1]; set -e argv[1]

        set json (jq -n --arg trigger "$trigger" '{
        "BTTPredefinedActionType" : 248,
        "BTTNamedTriggerToTrigger" : $trigger,
        }'
        )

        btt-preset trigger-action "$json"
    case "get-variable"
        set trigger $argv[1]; set -e argv[1]

        set json (jq -n --arg trigger "$trigger" '{
        "BTTPredefinedActionType" : 248,
        "BTTNamedTriggerToTrigger" : $trigger,
        }'
        )

        btt-preset trigger-action "$json"
    case "trigger-menu-status"
        argparse --min 1 --exclusive left-click,right-click,just-move left-click right-click just-move -- $argv
        or return 1

        if test -n "$_flag_left_click"
            set click_type 0
        else if test -n "$_flag_right_click"
            set click_type 1
        else if test -n "$_flag_just_move"
            set click_type 2
        else
            return 1
        end

        set menu $argv[1]; set -e argv[1]

        set json (jq -n --arg menu "$menu" --arg click_type "$click_type" -- '
        {
        "BTTPredefinedActionType" : 375,
        "BTTActionStatusItem" : $menu,
        "BTTActionStatusItemClickType" : $click_type,
        "BTTEnabled2" : 1,
        "BTTOrder" : 0
        }
        '
        )

        btt-preset trigger-action "$json"
    case "send-keys"
        set json (
            jq -nc --arg codes "$(btt-preset get-key-codes $argv)" '
                {
                    "BTTShortcutToSend" : $codes
                }
            '
        )

        btt-preset trigger-action "$json"
    case "get-key-codes"
        printf "%s\n" $argv | jq -Rsr '
            {
                "ctrl": 59, "shift": 56, "alt": 58, "cmd": 55,
                "a": 0, "b": 11, "c": 8, "d": 2, "e": 14, "f": 3,
                "g": 5, "h": 4, "i": 34, "j": 38, "k": 40, "l": 37,
                "m": 46, "n": 45, "o": 31, "p": 35, "q": 12, "r": 15,
                "s": 1, "t": 17, "u": 32, "v": 9, "w": 13, "x": 7,
                "y": 16, "z": 6, "space": 49, "return": 36, "left": 123,
                "right": 124, "up": 126, "down": 125, "fn": 63, "1": 18,
                "2": 19, "3": 20, "4": 21, "5": 23, "6": 22, "7": 26,
                "8": 28, "9": 25, "0": 29
            } as $map
            | rtrimstr("\n")
            | split("\n")
            | map(. as $key | $map[.] | if . == null then error("\($key) is not mapped") else . end)
            | join(",")
        '
    end
end
