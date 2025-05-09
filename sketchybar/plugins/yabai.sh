#!/opt/homebrew/bin/fish

yabai -m query --spaces \
| jq -r 'length, (map(select(."has-focus"))[0] | .index, .type)' \
| read --line spaces_count space_number space_mode

set window_mode "$(yabai-preset print-window-mode)"

sketchybar -m --set yabai label="$space_mode:$space_number/$spaces_count ($window_mode)"
