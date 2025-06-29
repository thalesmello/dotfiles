hs.loadSpoon("EmmyLua")
require("hs.ipc")
local util = require('util')

local hyperShift = {"ctrl", "cmd", "alt", "shift"}
local hyper = {"ctrl", "cmd", "shift"}

hs.hotkey.bind(hyperShift, 'B', function() hs.toggleConsole() end)

if not hs.ipc.cliStatus(nil, true) then
  hs.ipc.cliInstall()
end

util.notify("Hammerspoon!")

