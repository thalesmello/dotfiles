hs.loadSpoon("EmmyLua")
require("hs.ipc")
local util = require('util')

-- Config {{{ --
local mash = {
  ctrl         = {"ctrl"},
  ctrlCmd      = {"ctrl", "cmd"},
  ctrlShift      = {"ctrl", "shift"},
  ctrlAlt      = {"ctrl", "alt"},
  altCmd       = {"ctrl", "cmd", "alt"},
  hyperShift       = {"ctrl", "cmd", "alt", "shift"},
  ctrlShiftCmd = {"ctrl", "cmd", "shift"},
}

hs.hotkey.bind(mash.hyperShift, 'B', function() hs.toggleConsole() end)

-- }}} Config --
-- Octomux {{{ --
if not hs.ipc.cliStatus(nil, true) then
  hs.ipc.cliInstall()
end

-- nonRecursiveBind({"ctrl"}, "H", except({ "iTerm2", "RStudio" }, function() hs.window.focusedWindow():focusWindowWest()  end))
-- nonRecursiveBind({"ctrl"}, "J", except({ "iTerm2", "RStudio" }, function() hs.window.focusedWindow():focusWindowSouth() end))
-- nonRecursiveBind({"ctrl"}, "K", except({ "iTerm2", "RStudio" }, function() hs.window.focusedWindow():focusWindowNorth() end))
-- nonRecursiveBind({"ctrl"}, "L", except({ "iTerm2", "RStudio" }, function() hs.window.focusedWindow():focusWindowEast()  end))

-- hs.hotkey.bind(mash.ctrlCmd, "H", function() hs.window.focusedWindow():focusWindowWest()  end)
-- hs.hotkey.bind(mash.ctrlCmd, "J", function() hs.window.focusedWindow():focusWindowSouth() end)
-- hs.hotkey.bind(mash.ctrlCmd, "K", function() hs.window.focusedWindow():focusWindowNorth() end)
-- hs.hotkey.bind(mash.ctrlCmd, "L", function() hs.window.focusedWindow():focusWindowEast()  end)

-- }}} Octomux --
-- Mappings {{{ --
-- hs.hotkey.bind(mash.ctrlCmd, 'h', function() hs.eventtap.keyStroke({"ctrl"}, "left") end)
-- hs.hotkey.bind(mash.ctrlCmd, 'l', function() hs.eventtap.keyStroke({"ctrl"}, "right") end)
-- hs.hotkey.bind(mash.ctrlShiftCmd, 'R', function() hs.reload() end)
-- hs.hotkey.bind(mash.ctrlShiftCmd, 'P', function() quickSystemStroke("PLAY") end)

-- }}} Mappings --
-- Mappings {{{ --
-- nonRecursiveBind(mash.ctrl, 'N', only({ "Google Chrome" }, function() quickKeyStroke({}, "tab")  end))
-- nonRecursiveBind(mash.ctrl, 'P', only({ "Google Chrome" }, function() quickKeyStroke({"shift"}, "tab")  end))
--

-- hs.hotkey.bind(mash.ctrlShift, 'A', function() hs.application.launchOrFocus("iTerm") end)
-- hs.hotkey.bind(mash.ctrlShift, 'S', function() hs.application.launchOrFocus("Google Chrome") end)
-- hs.hotkey.bind(mash.ctrlShift, 'D', function() hs.application.launchOrFocus("DataGrip") end)

-- }}} Mappings --
-- Vim compatibility {{{ --

-- hs.hotkey.bind(mash.altCmd, 'H', function()
--   hs.eventtap.scrollWheel({ 0, 1 }, {"shift"}, 'pixel')
--   hs.eventtap.scrollWheel({ 0, 1 }, {"shift"}, 'pixel')
--   hs.eventtap.scrollWheel({ 0, 1 }, {"shift"}, 'pixel')
--   hs.eventtap.scrollWheel({ 0, 1 }, {"shift"}, 'pixel')
-- end)
--
-- hs.hotkey.bind(mash.altCmd, 'L', function()
--   hs.eventtap.scrollWheel({ 0, -1 }, {"shift"}, 'pixel')
--   hs.eventtap.scrollWheel({ 0, -1 }, {"shift"}, 'pixel')
--   hs.eventtap.scrollWheel({ 0, -1 }, {"shift"}, 'pixel')
--   hs.eventtap.scrollWheel({ 0, -1 }, {"shift"}, 'pixel')
-- end)
--
-- hs.hotkey.bind(mash.ctrl, '[', function() hs.eventtap.keyStroke({}, "escape") end)
-- -- nonRecursiveBind({"alt"}, "delete", only({ "iTerm2" }, function() quickKeyStroke({"ctrl"}, "W")  end))
-- -- nonRecursiveBind({"cmd"}, "delete", only({ "iTerm2" }, function() quickKeyStroke({"ctrl"}, "U")  end))
-- nonRecursiveBind({"ctrl"}, "w", only({ "RStudio" }, function() quickKeyStroke({"alt"}, "delete")  end))
-- nonRecursiveBind({"ctrl"}, "u", only({ "RStudio" }, function()
--   quickKeyStroke({}, "up")
--   quickKeyStroke({}, "up")
--   quickKeyStroke({}, "up")
--   quickKeyStroke({}, "up")
--   quickKeyStroke({}, "up")
--   quickKeyStroke({}, "up")
--   quickKeyStroke({}, "up")
--   quickKeyStroke({}, "up")
--   quickKeyStroke({}, "up")
--   quickKeyStroke({}, "up")
-- end))
-- nonRecursiveBind({"ctrl"}, "d", only({ "RStudio" }, function()
--   quickKeyStroke({}, "down")
--   quickKeyStroke({}, "down")
--   quickKeyStroke({}, "down")
--   quickKeyStroke({}, "down")
--   quickKeyStroke({}, "down")
--   quickKeyStroke({}, "down")
--   quickKeyStroke({}, "down")
--   quickKeyStroke({}, "down")
--   quickKeyStroke({}, "down")
--   quickKeyStroke({}, "down")
-- end))
-- nonRecursiveBind({"ctrl"}, "e", only({ "RStudio" }, function()
--   quickKeyStroke({}, "down")
--   quickKeyStroke({}, "down")
--   quickKeyStroke({}, "down")
--   quickKeyStroke({}, "down")
--   quickKeyStroke({}, "down")
-- end))
-- nonRecursiveBind({"ctrl"}, "y", only({ "RStudio" }, function()
--   quickKeyStroke({}, "up")
--   quickKeyStroke({}, "up")
--   quickKeyStroke({}, "up")
--   quickKeyStroke({}, "up")
--   quickKeyStroke({}, "up")
-- end))
--
-- nonRecursiveBind({"cmd", "shift"}, "[", only({ "iTerm2" }, function()
--   quickKeyStroke({"ctrl"}, "space")
--   quickKeyStroke({"ctrl"}, "H")
-- end))
--
-- nonRecursiveBind({"cmd", "shift"}, "]", only({ "iTerm2" }, function()
--   quickKeyStroke({"ctrl"}, "space")
--   quickKeyStroke({"ctrl"}, "L")
-- end))

-- nonRecursiveBind({"cmd"}, "C", only({ "iTerm2" }, function()
--   quickKeyStroke({}, "return")
-- end))

-- nonRecursiveBind({"cmd"}, "T", only({ "iTerm2" }, function()
--   quickKeyStroke({"ctrl"}, "space")
--   quickKeyStroke({}, "C")
-- end))

-- nonRecursiveBind({"cmd"}, "W", only({ "iTerm2" }, function()
--   quickKeyStroke({"ctrl"}, "space")
--   quickKeyStroke({}, "X")
-- end))

-- -- Horizontal scroll
-- scrollBind = hs.eventtap.new({hs.eventtap.event.types.scrollWheel}, function(e)
--   if is_active('iTerm2') then
--     local horizontalOffset = e:getProperty(hs.eventtap.event.properties.scrollWheelEventDeltaAxis2)

--     if horizontalOffset ~= 0 then
--       hs.eventtap.scrollWheel({ 0, horizontalOffset }, {"shift"}, 'pixel')
--       return true
--     end
--   end

--   return false
-- end):start()

-- }}}  Vim compatibility --
-- Utils {{{ --

-- function is_active(program_name)
--   local active_window_name = hs.window.focusedWindow():application():name()
--   return active_window_name == program_name
-- end

-- }}} ctrlShiftCmd --
-- Caffeine {{{ --
-- local caffeine = hs.menubar.new()
-- function setCaffeineDisplay(state)
--     local result
--     if state then
--         result = caffeine:setIcon("caffeine-on.pdf")
--     else
--         result = caffeine:setIcon("caffeine-off.pdf")
--     end
-- end
--
-- function caffeineClicked()
--     setCaffeineDisplay(hs.caffeinate.toggle("displayIdle"))
-- end
--
-- if caffeine then
--     caffeine:setClickCallback(caffeineClicked)
--     setCaffeineDisplay(hs.caffeinate.get("displayIdle"))
-- end
--
-- hs.hotkey.bind(mash.ctrlShiftCmd, "c", function() caffeineClicked() end)

-- }}} Caffeine --
-- Windows {{{ --
-- Setup animation to avoid lag
-- hs.window.animationDuration = 0

-- Resize windows
-- local function approximatelyEqual(a, b)
--   local diff = math.abs(a - b)
--   return diff < 0.01
-- end

-- local function adjust(x, y, w, h)
--   return function()
--     local win = hs.window.focusedWindow()
--
--     if not win or win:isFullScreen() then return end
--
--     local f = win:frame()
--     local max = win:screen():frame()
--
--     f.w = math.floor(max.w * w)
--     f.h = math.floor(max.h * h)
--     f.x = math.floor((max.w * x) + max.x)
--     f.y = math.floor((max.h * y) + max.y)
--
--     win:setFrame(f)
--   end
-- end
--
-- local function adjustCenter(w, h)
--   return function()
--     local win = hs.window.focusedWindow()
--     if not win then return end
--
--     local f = win:frame()
--     local max = win:screen():frame()
--
--     f.w = math.floor(max.w * w)
--     f.h = math.floor(max.h * h)
--     f.x = math.floor((max.w / 2) - (f.w / 2))
--     f.y = math.floor((max.h / 2) - (f.h / 2))
--     win:setFrame(f)
--   end
-- end

-- local function getCurrentProportions()
--   local win = hs.window.focusedWindow()
--   if not win then return end
--
--   local f = win:frame()
--   local max = win:screen():frame()
--
--   return {
--     w = f.w / max.w,
--     h = f.h / max.h,
--     x = f.x / max.w,
--     y = f.y / max.h
--   }
-- end
--
-- local function setWindowConfig(config)
--   local win = hs.window.focusedWindow()
--   if not win or win:isFullScreen() then return end
--
--   local f = win:frame()
--   local max = win:screen():frame()
--
--   f.w = math.floor(max.w * config.w)
--   f.h = math.floor(max.h * config.h)
--   f.x = math.floor((max.w * config.x) + max.x)
--   f.y = math.floor((max.h * config.y) + max.y)
--
--   win:setFrame(f)
-- end
--
-- local function adjustCycle(windowConfigs)
--   return function()
--     local win = hs.window.focusedWindow()
--     if not win or win:isFullScreen() then return end
--
--     local current = getCurrentProportions()
--
--     local config
--     local nextConfig
--
--     for i = 1, #windowConfigs do
--       config = windowConfigs[i]
--
--       if approximatelyEqual(config.w, current.w) and approximatelyEqual(config.x, current.x) then
--         nextConfig = windowConfigs[(i % #windowConfigs) + 1]
--
--         setWindowConfig(nextConfig)
--         return
--       end
--     end
--
--     setWindowConfig(windowConfigs[1])
--   end
-- end

-- -- top half
-- hs.hotkey.bind(mash.ctrlCmd, "up", adjust(0, 0, 1, 0.5))

-- -- right half
-- hs.hotkey.bind(mash.ctrlCmd, "right", adjust(0.5, 0, 0.5, 1))
-- hs.hotkey.bind(mash.ctrlCmd, ".", adjustCycle({
--   { x = 0.5, y = 0, w = 0.5, h = 1 },
--   { x = 0.75, y = 0, w = 0.25, h = 1 },
--   { x = 0.625, y = 0, w = 0.375, h = 1 },
--   { x = 0.5, y = 0, w = 0.25, h = 1 },
-- }))
-- hs.hotkey.bind(mash.ctrlShiftCmd, ".", adjustCycle({
--   { x = 0.25, y = 0, w = 0.75, h = 1 },
--   { x = 0.375, y = 0, w = 0.625, h = 1 },
-- }))

-- -- bottom half
-- hs.hotkey.bind(mash.ctrlCmd, "down", adjust(0, 0.5, 1, 0.5))

-- -- left half
-- hs.hotkey.bind(mash.ctrlCmd, "left", adjust(0, 0, 0.5, 1))
-- hs.hotkey.bind(mash.ctrlCmd, ",", adjustCycle({
--   { x = 0, y = 0, w = 0.5, h = 1 },
--   { x = 0, y = 0, w = 0.25, h = 1 },
--   { x = 0, y = 0, w = 0.375, h = 1 },
--   { x = 0.25, y = 0, w = 0.25, h = 1 }
-- }))

-- hs.hotkey.bind(mash.ctrlShiftCmd, ",", adjustCycle({
--   { x = 0, y = 0, w = 0.75, h = 1 },
--   { x = 0, y = 0, w = 0.625, h = 1 },
-- }))

-- -- top left
-- hs.hotkey.bind(mash.altCmd, "up", adjust(0, 0, 0.5, 0.5))

-- -- top right
-- hs.hotkey.bind(mash.altCmd, "right", adjust(0.5, 0, 0.5, 0.5))

-- -- bottom right
-- hs.hotkey.bind(mash.altCmd, "down", adjust(0.5, 0.5, 0.5, 0.5))

-- -- bottom left
-- hs.hotkey.bind(mash.altCmd, "left", adjust(0, 0.5, 0.5, 0.5))

-- -- fullscreen
-- hs.hotkey.bind(mash.ctrlCmd, "m", adjust(0, 0, 1, 1))
-- }}} Windows --
-- Wifi {{{ --
-- hs.hotkey.bind(mash.ctrlShiftCmd, "I", function()
--   local ssid = hs.wifi.currentNetwork()
--   if not ssid then return end
--
--   hs.alert.show("Reconnecting to: " .. ssid)
--   hs.execute("networksetup -setairportpower en0 off")
--   hs.execute("networksetup -setairportpower en0 on")
-- end)
-- }}} Wifi --
-- Battery {{{ --
-- local previousPowerSource = hs.battery.powerSource()

-- function showBatteryStatus()
--   local message
--
--   if hs.battery.isCharging() then
--     local pct = hs.battery.percentage()
--     local untilFull = hs.battery.timeToFullCharge()
--     message = "Charging"
--
--     if untilFull == -1 then
--       message = string.format("%s %.0f%% (calculating...)", message, pct);
--     else
--       message = string.format("%s %.0f%% (%s remaining)", message, pct, minutesToHours(untilFull))
--     end
--   elseif hs.battery.powerSource() == "Battery Power" then
--     local pct = hs.battery.percentage()
--     local untilEmpty = hs.battery.timeRemaining()
--     message = "Battery"
--
--     if untilEmpty == -1 then
--       message = string.format("%s %.0f%% (calculating...)", message, pct)
--     else
--       message = string.format("%s %.0f%% (%s remaining)", message, pct, minutesToHours(untilEmpty))
--     end
--   else
--     message = "Fully charged"
--   end
--
--   hs.alert.show(message)
-- end

-- function batteryChangedCallback()
--   local powerSource = hs.battery.powerSource()
--
--   if powerSource ~= previousPowerSource then
--     showBatteryStatus()
--     previousPowerSource = powerSource;
--   end
-- end

-- hs.battery.watcher.new(batteryChangedCallback):start()

-- hs.hotkey.bind(mash.ctrlShiftCmd, "b", showBatteryStatus)
-- }}} battery --
-- Report {{{ --
util.notify("Hammerspoon!")
-- }}} Report --

