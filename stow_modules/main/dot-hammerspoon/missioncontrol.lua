local shell = require("shell")
local util = require("util")
local ArgList = require("arglist")
local Preset = require("preset")

local M = {}

local eventTypes = hs.eventtap.event.types
local eventProps = hs.eventtap.event.properties

local function whenMissionControlActive(fn)
  shell.task({"osascript-preset", "is-mission-control-active"}, function(_, active)
    if active == "true" then fn() end
  end)
end

local function closeWindowUnderCursor()
  util.log("missioncontrol: right click, closing window under cursor")
  shell.task({"yabai", "-m", "window", "mouse", "--close"})
end

local function toggleWindowUnderCursorInArgList()
  util.log("missioncontrol: middle click, toggling window under cursor in arglist")
  shell.task({"yabai", "-m", "query", "--windows", "--window", "mouse", print_stdout = false}, function(ok, out)
    if not ok or out == "" then
      Preset.displayMessage("ArgList: no window under cursor")
      return
    end

    local decodedOk, window = pcall(hs.json.decode, out)
    if not decodedOk or type(window) ~= "table" or window.id == nil then
      Preset.displayMessage("ArgList: could not read window under cursor")
      return
    end

    local id = tostring(window.id)
    local action = ArgList.toggle(id)
    if action == "added" then ArgList.noteFocused(id) end
    local verb = action == "added" and "Marked" or "Unmarked"
    Preset.displayMessage(verb .. " window " .. id .. " (" .. ArgList.count() .. " marked)")
  end)
end

-- While Mission Control is on screen, a right click closes the window whose
-- tile sits under the cursor, and a middle click toggles that window in the
-- ArgList. Detection (osascript-preset), close/query (yabai), and list writes
-- run as async tasks, so the eventtap callback never blocks the system mouse
-- path; we let the event pass through and act on the side.
function M.setup()
  local tap
  tap = hs.eventtap.new({eventTypes.rightMouseUp, eventTypes.otherMouseUp}, function(event)
    local eventType = event:getType()
    if eventType == eventTypes.rightMouseUp then
      whenMissionControlActive(closeWindowUnderCursor)
    elseif eventType == eventTypes.otherMouseUp then
      local button = event:getProperty(eventProps.mouseEventButtonNumber)
      if button == 2 then
        whenMissionControlActive(toggleWindowUnderCursorInArgList)
      end
    end
    -- Never swallow the click: outside Mission Control it must still reach apps.
    return false
  end)

  tap:start()
  _G.MissionControlMouseClick = tap
  _G.MissionControlRightClick = tap
end

return M
