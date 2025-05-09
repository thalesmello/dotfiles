#!/opt/homebrew/bin/fish

set space_number "$(yabai -m query --spaces --display | jq 'map(select(."has-focus"))[-1].index')"
set yabai_mode "$(yabai -m query --spaces --display | jq -r 'map(select(."has-focus"))[-1].type')"

set window_mode "$(yabai-preset print-window-mode)"
sketchybar -m --set yabai label="$space_number:$yabai_mode ($window_mode)"
