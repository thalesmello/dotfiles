#!/bin/bash

space_number=$(yabai -m query --spaces --display | jq 'map(select(."has-focus"))[-1].index')
yabai_mode=$(yabai -m query --spaces --display | jq -r 'map(select(."has-focus"))[-1].type')

echo hi
yabai -m query --spaces --display | jq -r 'map(select(."has-focus"))[-1].type'

sketchybar -m --set yabai label="$space_number:$yabai_mode"
