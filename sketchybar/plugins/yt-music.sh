#!/bin/bash

# FROM: https://github.com/manishprivet/.dotfiles/blob/4c265e350b5fe81ab61dcda3a7ec46c3c5f73b4c/.config/sketchybar/plugins/youtube-music.sh

# Open app on middle click
if [ "$BUTTON" = "other" ]; then
  open -a 'YouTube Music'
  exit 0
fi

# Toggle play/pause on left click
if [ "$BUTTON" = "left" ]; then
  curl -s -X POST 0.0.0.0:26538/api/v1/toggle-play
fi

# Skip to next song on right click
if [ "$BUTTON" = "right" ]; then
  curl -s -X POST 0.0.0.0:26538/api/v1/next
fi

SONG_INFO=$(curl -s 0.0.0.0:26538/api/v1/song-info)

PAUSED="$(echo "$SONG_INFO" | jq -r '.isPaused')"
CURRENT_SONG="$(echo "$SONG_INFO" | jq -r '.title + " - " + .artist')"
ARTWORK="$(echo "$SONG_INFO" | jq -r '.imageSrc')"
ARTWORK_LOCATION="$(curl -O --output-dir "$TMPDIR" -s --remote-name -w "%{filename_effective}" "$ARTWORK")"

if [ "$PAUSED" = true ]; then
  ICON=􀊄
else
  ICON=􁁒
fi
sketchybar --set "$NAME" label="$CURRENT_SONG" icon="$ICON" drawing=on 
sketchybar --set "$NAME"-artwork background.image="$ARTWORK_LOCATION"
