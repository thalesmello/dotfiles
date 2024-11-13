function move-display -a location
    betterdisplaycli perform --originalName (osascript -e 'tell application "System Events" to display name of desktop 2') --targetOriginalName (osascript -e 'tell application "System Events" to display name of desktop 1') --moveTo $location
end

complete -c move-display -f
complete -c move-display -n "__fish_is_nth_token 1" -f -d "Location of the secondary display in relation to main display" -a "topLeftCorner topLeft top topRight topRightCorner leftTop left leftBottom rightTop right rightBottom bottomLeftCorner bottomLeft bottom bottomRight bottomRightCorner"
