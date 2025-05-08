function btt-preset
    set preset $argv[1]
    set -e argv[1]
    set btt_url 'http://localhost:12000/'

    if test "$preset" = "trigger-action"
        set json $argv[1]
        set -e argv[1]

        set json (string escape --style=url "$json")
        curl -sSG "$btt_url""trigger_action/" -d "json=$json"
    else if test "$preset" = "get-string-variable"
        set var $argv[1]
        set -e argv[1]

        set var (string escape --style=url "$var")

        curl -sSG "$btt_url""get_string_variable/" -d "variableName=$var"
    else if test "$preset" = "get-number-variable"
        set var $argv[1]
        set -e argv[1]

        set var (string escape --style=url "$var")

        curl -SG "$btt_url""get_number_variable/" -d "variableName=$var"
    else if test "$preset" = "focus-space"
        set space $argv[1]
        set -sSe argv[1]

        set json (jq -nc --argjson spc "$space" '{"BTTPredefinedActionType":(206 + $spc)}')

        btt-preset trigger-action "$json"
    else if test "$preset" = "move-window-to-space"
        set space $argv[1]
        set -e argv[1]

        set json (jq -nc --argjson spc "$space" '{"BTTPredefinedActionType":(215 + $spc + if $spc >= 6 then 1 else 0 end)}')

        btt-preset trigger-action "$json"
    else if test "$preset" = "move-window-to-next-display"
        set json (jq -nc --argjson spc "$space" '{"BTTPredefinedActionType":(206 + $spc)}')
        btt-preset trigger-action "$json"
    else if test "$preset" = "display-message"
        set message $argv[1]
        set -e argv[1]

        set json "$(jq -n --arg message "$message" '{
          "BTTPredefinedActionType": 254,
          "BTTHUDActionConfiguration": {
            "BTTActionHUDBlur": true,
            "BTTActionHUDBackground": "0.000000, 0.000000, 0.000000, 0.000000",
            "BTTIconConfigImageHeight": 100,
            "BTTActionHUDPosition": 0,
            "BTTActionHUDDetail": "",
            "BTTActionHUDDuration": 0.15000000596046448,
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
    else if test "$preset" = "trigger-menu-bar"
        set path $argv[1]
        set -e argv[1]

        set json "$(jq -n --arg path "$path" '{
            "BTTPredefinedActionType" : 124,
            "BTTMenubarPath" : $path,
        }')"

        btt-preset trigger-action "$json"
    else if test "$preset" = "print-app-path"
        set app $argv[1]
        set -e argv[1]

        osascript -e "POSIX path of (path to application \"$app\")"
    else if test "$preset" = "show-or-hide-app"
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
    else if test "$preset" = "trigger-named-trigger"
        set trigger $argv[1]; set -e argv[1]

        set json (jq -n --arg trigger "$trigger" '{
        "BTTPredefinedActionType" : 248,
        "BTTNamedTriggerToTrigger" : $trigger,
        }'
        )

        btt-preset trigger-action "$json"
    else if test "$preset" = "get-variable"
        set trigger $argv[1]; set -e argv[1]

        set json (jq -n --arg trigger "$trigger" '{
        "BTTPredefinedActionType" : 248,
        "BTTNamedTriggerToTrigger" : $trigger,
        }'
        )

        btt-preset trigger-action "$json"
    end
end
