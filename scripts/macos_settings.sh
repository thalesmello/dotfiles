#!/bin/sh

# key repeat
defaults write -g InitialKeyRepeat -int 15 # normal minimum is 15 (225 ms)
defaults write -g KeyRepeat -int 2

# enable three fingers drag
defaults -currentHost write NSGlobalDomain com.apple.trackpad.threeFingerSwipeGesture -int 1

# disable hold key for accent mac os
defaults write -g ApplePressAndHoldEnabled -bool false

# disable tap to click
defaults write "com.apple.AppleMultitouchTrackpad" "Clicking" -bool false
