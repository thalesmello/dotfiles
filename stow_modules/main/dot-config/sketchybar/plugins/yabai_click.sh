#!/bin/bash

if pgrep -xq AeroSpace; then
    # Cycle: tiles → accordion → tiles
    current_layout=$(aerospace list-windows --focused --format '%{window-layout}' 2>/dev/null)
    case "$current_layout" in
        tiles)
            aerospace layout accordion
            new_layout="accordion"
            ;;
        accordion)
            aerospace layout tiles
            new_layout="tiles"
            ;;
        *)
            aerospace layout tiles
            new_layout="tiles"
            ;;
    esac
    sketchybar -m --set yabai label="$new_layout"
else
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
fi
