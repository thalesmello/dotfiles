hs.loadSpoon("EmmyLua")
require("hs.ipc")
local util = require('util')

local hyperShift = {"ctrl", "cmd", "alt", "shift"}
local hyper = {"ctrl", "cmd", "shift"}

hs.console.darkMode(true)

hs.hotkey.bind(hyperShift, 'B', function() hs.toggleConsole() end)

if not hs.ipc.cliStatus(nil, true) then
  hs.ipc.cliInstall()
end

require("keybindings")
require("audiodevice")
require("screenwatcher")

-- Auto-reload config when files change
local watchPaths = {
  os.getenv("HOME") .. "/.hammerspoon",
  os.getenv("HOME") .. "/.local_dotfiles/local_hammerspoon",
}

local reloadWatchers = {}
for _, path in ipairs(watchPaths) do
  local watcher = hs.pathwatcher.new(path, function(files)
    hs.reload()
  end)
  if watcher then
    watcher:start()
    table.insert(reloadWatchers, watcher)
  end
end

util.notify("Hammerspoon!")

