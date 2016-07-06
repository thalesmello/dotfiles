local mash = {"ctrl", "cmd"}

hs.hotkey.bind(mash, 'H', function() hs.window.focusedWindow():focusWindowWest() end)
hs.hotkey.bind(mash, 'L', function() hs.window.focusedWindow():focusWindowEast() end)
hs.hotkey.bind(mash, 'K', function() hs.window.focusedWindow():focusWindowNorth() end)
hs.hotkey.bind(mash, 'J', function() hs.window.focusedWindow():focusWindowSouth() end)
