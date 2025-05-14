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
    case "complete-text-before-cursor"
        set old_clipboard (pbpaste)
        skhd -k "alt + shift - left"
        skhd -k "cmd - c"
        set candidate (pbpaste)
        skhd -k "alt + shift - right"
        set right_selection (pbpaste)
        printf "$old_clipboard" | pbcopy

        # Copied text doesn't change if selection is empty
        if test "$candidate" = "$right_selection" -a "$candidate" != "$old_clipboard"
            open "alfred://runtrigger/me.thalesmello.alfred.wordcomplete/trigger-word-complete/?argument=$candidate"
        else
            skhd -k "right"
            open "alfred://runtrigger/me.thalesmello.alfred.wordcomplete/trigger-word-complete/?argument="
        end
    case "*"
        return 1
    end
end
