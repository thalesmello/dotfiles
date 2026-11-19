# Local Hammerspoon tap

This tap follows the existing `homebrew/casks/thalesmello/homebrew-*` layout.
The `homebrew/.stowrc` links it into Homebrew's Taps directory; no separate
GitHub tap or startup-time compiler is needed.

## Install

Install Hammerspoon.app in /Applications first, then:

```sh
cd ~/src/dotfiles/homebrew && stow casks
brew install thalesmello/hammerspoon/hammerspoon-hidtap
```

The formula stages the local C source, compiles against the installed
Hammerspoon's Lua headers, ad-hoc signs the bundle, and installs it under
`$(brew --prefix)/opt/hammerspoon-hidtap/lib/hs_hidtap.so`

The Lua config loads that bundle to keep the HID-level/head-insert event tap
required to intercept physical middle-button holds before Mac Mouse Fix.

## Hammerspoon upgrades

This helper uses Hammerspoon's private eventtap userdata layout and exported
callback. Rebuild after a Hammerspoon upgrade and verify the private ABI if
upstream changes it:

```sh
brew reinstall thalesmello/hammerspoon/hammerspoon-hidtap
brew test thalesmello/hammerspoon/hammerspoon-hidtap
```

Then reload Hammerspoon. The config compares the app version recorded at build
time with the installed app and refuses an outdated Homebrew bundle.

During migration only, the existing /tmp/hs_hidtap.so can still be used if the
Homebrew bundle has not been installed. No compilation ever happens in Lua.
Install the formula before reboot, which may remove that legacy cache.
