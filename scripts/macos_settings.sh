#!/bin/sh

# key repeat
defaults write -g InitialKeyRepeat -int 15 # normal minimum is 15 (225 ms)
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
defaults write "com.apple.universalaccess" "reduceMotion" -bool true

# apps minimize with scale effect (least amount of time)
defaults write com.apple.dock "mineffect" -string "scale"

# disable reordering spaces based on use
defaults write com.apple.dock "mru-spaces" -bool "false"

# group windows based on application
defaults write com.apple.dock "expose-group-apps" -bool "true"

# displays have separate spaces
defaults write com.apple.spaces "spans-displays" -bool "false"

# hide menu bar
defaults write NSGlobalDomain _HIHideMenuBar -bool true
defaults write NSGlobalDomain AppleMenuBarVisibleInFullscreen -bool false

# Set top hight of rectangle pro to have space for Sketchy bar
defaults write com.knollsoft.Rectangle screenEdgeGapTop -int 30
defaults write com.knollsoft.Hookshot screenEdgeGapTop -int 30

# Enable Keyboard navigation
defaults write NSGlobalDomain AppleKeyboardUIMode -int 2
