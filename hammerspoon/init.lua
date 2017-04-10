require("hs.ipc")

-- Config {{{ --
local mash = {
  ctrl         = {"ctrl"},
  ctrlCmd      = {"ctrl", "cmd"},
  ctrlAlt      = {"ctrl", "alt"},
  altCmd       = {"ctrl", "cmd", "alt"},
  ctrlShiftCmd = {"ctrl", "cmd", "shift"},
}

-- }}} Config --
-- Octomux {{{ --
if not hs.ipc.cliStatus(null, true) then
  hs.ipc.cliInstall()
end

function nonRecursiveBind(mods, key, callback)
  local hotkey
  hotkey = hs.hotkey.bind(mods, key, function()
    callback(hotkey, mods, key)
  end)
end

function as_list(list)
  if type(list) ~= 'table' then
    list = { list }
  end

  return list
end

function currentWindowInList (listOfPrograms)
  local activeWindowName = hs.window.focusedWindow():application():name()
  for _, currentName in ipairs (listOfPrograms) do

      if currentName == activeWindowName then
          return true
      end
  end

  return false
end

function except(listOfPrograms, callback)
  listOfPrograms = as_list(listOfPrograms)

  return function(hotkey, mods, key)
    if currentWindowInList(listOfPrograms) then
      hotkey:disable()
      hs.eventtap.keyStroke(mods, key)
      hotkey:enable()
    else
      callback()
    end
  end
end

function only(listOfPrograms, callback)
  listOfPrograms = as_list(listOfPrograms)

  return function(hotkey, mods, key)
    if currentWindowInList(listOfPrograms) then
      callback()
    else
      hotkey:disable()
      hs.eventtap.keyStroke(mods, key)
      hotkey:enable()
    end
  end
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
hs.hotkey.bind(mash.ctrlCmd, 'H', function() hs.eventtap.keyStroke({"ctrl"}, "left") end)
hs.hotkey.bind(mash.ctrlCmd, 'L', function() hs.eventtap.keyStroke({"ctrl"}, "right") end)
hs.hotkey.bind(mash.ctrlShiftCmd, 'R', function() hs.reload() end)
hs.hotkey.bind(mash.ctrlShiftCmd, 'H', function() hs.toggleConsole() end)
hs.hotkey.bind(mash.ctrlShiftCmd, 'W', function() print(hs.window.focusedWindow():application():name()) end)

-- }}} Mappings --
-- Mappings {{{ --
-- nonRecursiveBind(mash.ctrl, 'N', only({ "Google Chrome" }, function() quickKeyStroke({}, "tab")  end))
-- nonRecursiveBind(mash.ctrl, 'P', only({ "Google Chrome" }, function() quickKeyStroke({"shift"}, "tab")  end))

-- }}} Mappings --
-- Vim compatibility {{{ --

hs.hotkey.bind(mash.altCmd, 'H', function()
  hs.eventtap.scrollWheel({ 0, 1 }, {"shift"}, 'pixel')
  hs.eventtap.scrollWheel({ 0, 1 }, {"shift"}, 'pixel')
  hs.eventtap.scrollWheel({ 0, 1 }, {"shift"}, 'pixel')
  hs.eventtap.scrollWheel({ 0, 1 }, {"shift"}, 'pixel')
end)

hs.hotkey.bind(mash.altCmd, 'L', function()
  hs.eventtap.scrollWheel({ 0, -1 }, {"shift"}, 'pixel')
  hs.eventtap.scrollWheel({ 0, -1 }, {"shift"}, 'pixel')
  hs.eventtap.scrollWheel({ 0, -1 }, {"shift"}, 'pixel')
  hs.eventtap.scrollWheel({ 0, -1 }, {"shift"}, 'pixel')
end)

hs.hotkey.bind(mash.ctrl, '[', function() hs.eventtap.keyStroke({}, "escape") end)
nonRecursiveBind({"alt"}, "delete", only({ "iTerm2" }, function() quickKeyStroke({"ctrl"}, "W")  end))
nonRecursiveBind({"cmd"}, "delete", only({ "iTerm2" }, function() quickKeyStroke({"ctrl"}, "U")  end))

nonRecursiveBind({"cmd", "shift"}, "[", only({ "iTerm2" }, function()
  quickKeyStroke({"ctrl"}, "space")
  quickKeyStroke({"ctrl"}, "H")
end))

nonRecursiveBind({"cmd", "shift"}, "]", only({ "iTerm2" }, function()
  quickKeyStroke({"ctrl"}, "space")
  quickKeyStroke({"ctrl"}, "L")
end))

nonRecursiveBind({"cmd"}, "C", only({ "iTerm2" }, function()
  quickKeyStroke({}, "return")
end))

nonRecursiveBind({"cmd"}, "T", only({ "iTerm2" }, function()
  quickKeyStroke({"ctrl"}, "space")
  quickKeyStroke({}, "C")
end))

nonRecursiveBind({"cmd"}, "W", only({ "iTerm2" }, function()
  quickKeyStroke({"ctrl"}, "space")
  quickKeyStroke({}, "X")
end))

-- Horizontal scroll
scrollBind = hs.eventtap.new({hs.eventtap.event.types.scrollWheel}, function(e)
  if is_active('iTerm2') then
    local horizontalOffset = e:getProperty(hs.eventtap.event.properties.scrollWheelEventDeltaAxis2)

    if horizontalOffset ~= 0 then
      hs.eventtap.scrollWheel({ 0, horizontalOffset }, {"shift"}, 'pixel')
      return true
    end
  end

  return false
end):start()

-- }}}  Vim compatibility --
-- Utils {{{ --
function notify(str)
  hs.alert.show(str)
end

function table_print (tt, indent, done)
  done = done or {}
  indent = indent or 0
  if type(tt) == "table" then
    local sb = {}
    for key, value in pairs (tt) do
      table.insert(sb, string.rep (" ", indent)) -- indent it
      if type (value) == "table" and not done [value] then
        done [value] = true
        table.insert(sb, "{\n");
        table.insert(sb, table_print (value, indent + 2, done))
        table.insert(sb, string.rep (" ", indent)) -- indent it
        table.insert(sb, "}\n");
      elseif "number" == type(key) then
        table.insert(sb, string.format("\"%s\"\n", tostring(value)))
      else
        table.insert(sb, string.format(
            "%s = \"%s\"\n", tostring (key), tostring(value)))
       end
    end
    return table.concat(sb)
  else
    return tt .. "\n"
  end
end

function to_string( tbl )
    if  "nil"       == type( tbl ) then
        return tostring(nil)
    elseif  "table" == type( tbl ) then
        return table_print(tbl)
    elseif  "string" == type( tbl ) then
        return tbl
    else
        return tostring(tbl)
    end
end

function log(obj)
  hs.logger.new('log', 'debug'):d('\n' .. to_string(obj))
end

function is_active(program_name)
  local active_window_name = hs.window.focusedWindow():application():name()
  return active_window_name == program_name
end

-- }}} ctrlShiftCmd --
-- Caffeine {{{ --
local caffeine = hs.menubar.new()
function setCaffeineDisplay(state)
    local result
    if state then
        result = caffeine:setIcon("caffeine-on.pdf")
    else
        result = caffeine:setIcon("caffeine-off.pdf")
    end
end

function caffeineClicked()
    setCaffeineDisplay(hs.caffeinate.toggle("displayIdle"))
end

if caffeine then
    caffeine:setClickCallback(caffeineClicked)
    setCaffeineDisplay(hs.caffeinate.get("displayIdle"))
end

hs.hotkey.bind(mash.ctrlShiftCmd, "c", function() caffeineClicked() end)

function quickKeyStroke (modifiers, character)
    local event = require("hs.eventtap").event
    event.newKeyEvent(modifiers, string.lower(character), true):post()
    event.newKeyEvent(modifiers, string.lower(character), false):post()
end
-- }}} Caffeine --
-- Windows {{{ --
-- Setup animation to avoid lag
hs.window.animationDuration = 0

-- Resize windows
local function adjust(x, y, w, h)
  return function()
    local win = hs.window.focusedWindow()

    if not win or win:isFullScreen() then return end

    local f = win:frame()
    local max = win:screen():frame()

    f.w = math.floor(max.w * w)
    f.h = math.floor(max.h * h)
    f.x = math.floor((max.w * x) + max.x)
    f.y = math.floor((max.h * y) + max.y)

        win:setFrame(f)
  end
end

local function adjustCenter(w, h)
  return function()
        local win = hs.window.focusedWindow()
        if not win then return end

        local f = win:frame()
        local max = win:screen():frame()

        f.w = math.floor(max.w * w)
        f.h = math.floor(max.h * h)
        f.x = math.floor((max.w / 2) - (f.w / 2))
        f.y = math.floor((max.h / 2) - (f.h / 2))
        win:setFrame(f)
  end
end

-- top half
hs.hotkey.bind(mash.ctrlCmd, "up", adjust(0, 0, 1, 0.5))

-- right half
hs.hotkey.bind(mash.ctrlCmd, "right", adjust(0.5, 0, 0.5, 1))
hs.hotkey.bind(mash.ctrlCmd, ".", adjust(0.5, 0, 0.5, 1))

-- bottom half
hs.hotkey.bind(mash.ctrlCmd, "down", adjust(0, 0.5, 1, 0.5))

-- left half
hs.hotkey.bind(mash.ctrlCmd, "left", adjust(0, 0, 0.5, 1))
hs.hotkey.bind(mash.ctrlCmd, ",", adjust(0, 0, 0.5, 1))

-- top left
hs.hotkey.bind(mash.altCmd, "up", adjust(0, 0, 0.5, 0.5))

-- top right
hs.hotkey.bind(mash.altCmd, "right", adjust(0.5, 0, 0.5, 0.5))

-- bottom right
hs.hotkey.bind(mash.altCmd, "down", adjust(0.5, 0.5, 0.5, 0.5))

-- bottom left
hs.hotkey.bind(mash.altCmd, "left", adjust(0, 0.5, 0.5, 0.5))

-- fullscreen
hs.hotkey.bind(mash.ctrlCmd, "m", adjust(0, 0, 1, 1))
-- }}} Windows --
-- Wifi {{{ --
function ssidChangedCallback()
    local ssid = hs.wifi.currentNetwork()
    if ssid then
      hs.alert.show("Network connected: " .. ssid)
    end
end

hs.wifi.watcher.new(ssidChangedCallback):start()

hs.hotkey.bind(mash.ctrlShiftCmd, "I", function()
  local ssid = hs.wifi.currentNetwork()
  if not ssid then return end

  hs.alert.show("Reconnecting to: " .. ssid)
  hs.execute("networksetup -setairportpower en0 off")
  hs.execute("networksetup -setairportpower en0 on")
end)
-- }}} Wifi --
-- Battery {{{ --
local previousPowerSource = hs.battery.powerSource()

function minutesToHours(minutes)
  if minutes <= 0 then
    return "0:00";
  else
    hours = string.format("%d", math.floor(minutes / 60))
    mins = string.format("%02.f", math.floor(minutes - (hours * 60)))
    return string.format("%s:%s", hours, mins)
  end
end

function showBatteryStatus()
  local message

  if hs.battery.isCharging() then
    local pct = hs.battery.percentage()
    local untilFull = hs.battery.timeToFullCharge()
    message = "Charging"

    if untilFull == -1 then
      message = string.format("%s %.0f%% (calculating...)", message, pct);
    else
      message = string.format("%s %.0f%% (%s remaining)", message, pct, minutesToHours(untilFull))
    end
  elseif hs.battery.powerSource() == "Battery Power" then
    local pct = hs.battery.percentage()
    local untilEmpty = hs.battery.timeRemaining()
    message = "Battery"

    if untilEmpty == -1 then
      message = string.format("%s %.0f%% (calculating...)", message, pct)
    else
      message = string.format("%s %.0f%% (%s remaining)", message, pct, minutesToHours(untilEmpty))
    end
  else
    message = "Fully charged"
  end

  hs.alert.show(message)
end

function batteryChangedCallback()
  local powerSource = hs.battery.powerSource()

  if powerSource ~= previousPowerSource then
    showBatteryStatus()
    previousPowerSource = powerSource;
  end
end

hs.battery.watcher.new(batteryChangedCallback):start()

hs.hotkey.bind(mash.ctrlShiftCmd, "b", showBatteryStatus)
-- }}} battery --
-- Report {{{ --
notify("Hammerspoon!")
-- }}} Report --


