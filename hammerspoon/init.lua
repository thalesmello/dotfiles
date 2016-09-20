require("hs.ipc")

local application = require "hs.application"
local fnutils = require "hs.fnutils"
local grid = require "hs.grid"
local hotkey = require "hs.hotkey"
local mjomatic = require "hs.mjomatic"
local window = require "hs.window"


if not hs.ipc.cliStatus(null, true) then
  hs.ipc.cliInstall()
end

function nonRecursiveBind(mods, key, callback)
  local hotkey
  hotkey = hs.hotkey.bind(mods, key, function()
    callback(hotkey, mods, key)
  end)
end

function except(programName, callback)
  return function(hotkey, mods, key)
    local currentName = hs.window.focusedWindow():application():name()
    if currentName == programName then
      hotkey:disable()
      hs.eventtap.keyStroke(mods, key)
      hotkey:enable()
    else
      callback()
    end
  end
end

nonRecursiveBind({"ctrl"}, "H", except("iTerm2", function() hs.window.focusedWindow():focusWindowWest()  end))
nonRecursiveBind({"ctrl"}, "J", except("iTerm2", function() hs.window.focusedWindow():focusWindowSouth() end))
nonRecursiveBind({"ctrl"}, "K", except("iTerm2", function() hs.window.focusedWindow():focusWindowNorth() end))
nonRecursiveBind({"ctrl"}, "L", except("iTerm2", function() hs.window.focusedWindow():focusWindowEast()  end))

hs.hotkey.bind({"ctrl", "cmd"}, 'H', function() hs.eventtap.keyStroke({"ctrl"}, "left") end)
hs.hotkey.bind({"ctrl", "cmd"}, 'L', function() hs.eventtap.keyStroke({"ctrl"}, "right") end)
hs.hotkey.bind({"ctrl", "cmd", "shift"}, 'R', function() hs.reload() end)
hs.hotkey.bind({"ctrl", "cmd", "shift"}, 'H', function()
  hs.eventtap.scrollWheel({ 0, 1 }, {"shift"}, 'pixel')
  hs.eventtap.scrollWheel({ 0, 1 }, {"shift"}, 'pixel')
  hs.eventtap.scrollWheel({ 0, 1 }, {"shift"}, 'pixel')
  hs.eventtap.scrollWheel({ 0, 1 }, {"shift"}, 'pixel')
end)
hs.hotkey.bind({"ctrl", "cmd", "shift"}, 'L', function()
  hs.eventtap.scrollWheel({ 0, -1 }, {"shift"}, 'pixel')
  hs.eventtap.scrollWheel({ 0, -1 }, {"shift"}, 'pixel')
  hs.eventtap.scrollWheel({ 0, -1 }, {"shift"}, 'pixel')
  hs.eventtap.scrollWheel({ 0, -1 }, {"shift"}, 'pixel')
end)

hs.hotkey.bind({"ctrl", "cmd", "alt"}, 'H', function() hs.toggleConsole() end)

-- Utils
function notify(str)
  hs.notify.new({title="Hammerspoon", informativeText=str}):send()
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

-- BrianGilbert's init.lua

grid.MARGINX = 0
grid.MARGINY = 0
grid.GRIDHEIGHT = 5
grid.GRIDWIDTH = 5

local mash = {"cmd", "alt", "ctrl"}
local mashshift = {"cmd", "alt", "ctrl", "shift"}


--
-- replace caffeine
--
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

hs.hotkey.bind(mash, "/", function() caffeineClicked() end)
--
-- /replace caffeine
--
