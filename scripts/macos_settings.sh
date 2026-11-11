#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SPOTLIGHT_EXCLUSIONS_FILE="${SPOTLIGHT_EXCLUSIONS_FILE:-$SCRIPT_DIR/spotlight-exclusions.txt}"
SPOTLIGHT_PLIST="${SPOTLIGHT_PLIST:-/System/Volumes/Data/.Spotlight-V100/VolumeConfiguration.plist}"

# key repeat
defaults write -g InitialKeyRepeat -int 20 # normal minimum is 15 (225 ms)
defaults write -g KeyRepeat -int 2

# enable three fingers drag
defaults write com.apple.AppleMultitouchTrackpad "TrackpadThreeFingerDrag" -bool "true"

# Disable 3 finger for app expose and mission control
defaults write com.apple.AppleMultitouchTrackpad "TrackpadFiveFingerPinchGesture" -int 2
defaults write com.apple.AppleMultitouchTrackpad "TrackpadFourFingerHorizSwipeGesture" -int 2
defaults write com.apple.AppleMultitouchTrackpad "TrackpadFourFingerPinchGesture" -int 2

# Use four fingers for mission control and app expose
defaults write com.apple.AppleMultitouchTrackpad "TrackpadThreeFingerHorizSwipeGesture" -int 0
defaults write com.apple.AppleMultitouchTrackpad "TrackpadThreeFingerVertSwipeGesture" -int 0
defaults write com.apple.AppleMultitouchTrackpad "TrackpadThreeFingerTapGesture" -int 0

# disable hold key for accent mac os
defaults write -g ApplePressAndHoldEnabled -bool false

# disable tap to click
defaults write "com.apple.AppleMultitouchTrackpad" "Clicking" -bool false

# reduce motion
defaults write "com.apple.universalaccess" "reduceMotion" -bool true 2>/dev/null || true

# Use hybrid Bluetooth/Wi-Fi coexistence management
sudo defaults write /Library/Preferences/com.apple.airport.bt.plist bluetoothCoexMgmt Hybrid

# apps minimize with scale effect (least amount of time)
defaults write com.apple.dock "mineffect" -string "scale"

# disable reordering spaces based on use
defaults write com.apple.dock "mru-spaces" -bool "false"

# group windows based on application
defaults write com.apple.dock "expose-group-apps" -bool "true"

# displays have separate spaces
defaults write com.apple.spaces "spans-displays" -bool "false"

# don't hide menu bar
defaults write NSGlobalDomain _HIHideMenuBar -bool false
defaults write NSGlobalDomain AppleMenuBarVisibleInFullscreen -bool false

# Enable Keyboard navigation
defaults write NSGlobalDomain AppleKeyboardUIMode -int 2

# Disable ctrl + command + d for lookup word
defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 70 '<dict><key>enabled</key><false/></dict>'

# Apply Spotlight exclusions from scripts/spotlight-exclusions.txt
if [ -f "$SPOTLIGHT_EXCLUSIONS_FILE" ]; then
  spotlight_plist_changed=0
  can_edit_spotlight_plist=0
  if sudo defaults read "$SPOTLIGHT_PLIST" Exclusions >/dev/null 2>&1; then
    can_edit_spotlight_plist=1
  fi

  while IFS= read -r raw_line || [ -n "$raw_line" ]; do
    line=$(printf '%s' "$raw_line" | sed 's/[[:space:]]*#.*$//; s/^[[:space:]]*//; s/[[:space:]]*$//')
    [ -z "$line" ] && continue

    case "$line" in
      "~/"*) target="$HOME/${line#\~/}" ;;
      "~") target="$HOME" ;;
      *) target="$line" ;;
    esac

    if [ -d "$target" ] && [ -w "$target" ]; then
      touch "$target/.metadata_never_index" 2>/dev/null || true
    fi

    if [ "$can_edit_spotlight_plist" -eq 1 ]; then
      if ! sudo defaults read "$SPOTLIGHT_PLIST" Exclusions 2>/dev/null | grep -Fq "\"$target\""; then
        sudo defaults write "$SPOTLIGHT_PLIST" Exclusions -array-add "$target"
        spotlight_plist_changed=1
      fi
    fi
  done < "$SPOTLIGHT_EXCLUSIONS_FILE"

  if [ "$spotlight_plist_changed" -eq 1 ]; then
    sudo launchctl kickstart -k system/com.apple.metadata.mds 2>/dev/null || sudo killall mds 2>/dev/null || true
  fi
fi

# Flush preference changes to running session without requiring logout
if [ -x /System/Library/PrivateFrameworks/SystemAdministration.framework/Resources/activateSettings ]; then
  /System/Library/PrivateFrameworks/SystemAdministration.framework/Resources/activateSettings -u
fi

killall Dock SystemUIServer 2>/dev/null || true
