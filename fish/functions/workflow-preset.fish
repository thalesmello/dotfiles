function workflow-preset

    set preset $argv[1]; set -e argv[1]

    switch "$preset"
    case "perform-default-ui"
        set app (btt-preset get-string-variable "active_app_name")

        if test "$app" = "Google Chrome"
            skhd -k 'cmd + shift - a'
        else if test "$app" = "BetterTouchTool"
            btt-preset trigger-named-trigger 'BTT: Click search button'
        end
    end
end
