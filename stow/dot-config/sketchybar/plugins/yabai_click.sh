#!/bin/bash

space_number=$(yabai -m query --spaces --display | jq 'map(select(."has-focus"))[-1].index')
yabai_mode=$(yabai -m query --spaces --display | jq -r 'map(select(."has-focus"))[-1].type')

case "$yabai_mode" in
    bsp)
    yabai -m config layout stack
    ;;
    stack)
    yabai -m config layout float
    ;;
    float)
    yabai -m config layout bsp
    ;;
esac

new_yabai_mode=$(yabai -m query --spaces --display | jq -r 'map(select(."has-focus"))[-1].type')

sketchybar -m --set yabai label="$space_number:$new_yabai_mode"
