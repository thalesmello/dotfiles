function move-display -a location
    argparse 'main=' -- $argv

    if set -q _flag_main
        betterdisplaycli set '--main=on' "--originalName=$_flag_main"
    end

    set location "$argv[1]"
    set mainDisplay (osascript -e 'tell application "System Events" to display name of desktop 1')
    set secondaryDisplay (osascript -e 'tell application "System Events" to display name of desktop 2')

    betterdisplaycli perform --originalName $secondaryDisplay --targetOriginalName $mainDisplay --moveTo "$location"
end

function __move_display_nth_token
    set n "$argv[1]"
    set -l tokens (commandline -poc)
    argparse 'main=' -- $tokens

    test (count $argv) -eq "$n"
end

complete -c move-display -f
complete -c move-display -n "__move_display_nth_token 1" -f -d "Location of the secondary display in relation to main display" -a "topLeftCorner topLeft top topRight topRightCorner leftTop left leftBottom rightTop right rightBottom bottomLeftCorner bottomLeft bottom bottomRight bottomRightCorner"
complete -c move-display -x -l "main" -d "Name of the display to make main" -a "(complete -C 'betterdisplaycli set --main=on --originalName ')"
