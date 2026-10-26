local shell = require("shell")
local util = require("util")
local ArgList = require("arglist")
local Preset = require("preset")

local M = {}

local eventTypes = hs.eventtap.event.types
local eventProps = hs.eventtap.event.properties

local IGNORED_OWNERS = {
  ["WindowManager"] = true,
  ["Dock"] = true,
  ["Window Server"] = true,
  ["Wallpaper"] = true,
  ["Notification Center"] = true,
  ["borders"] = true,
  ["hs"] = true,
  ["Mouseless"] = true,
  ["BetterDisplay"] = true,
}

-- Inspect on-screen CGWindows synchronously in-process. While Mission Control
-- (or App Expose) is up, WindowManager (macOS 27+) or Dock (earlier macOS)
-- owns shield/icon windows at layers 17-19, and the window preview tiles at
-- layer 0 carry their transformed Mission Control bounds in front-to-back
-- order.
local function inspectMissionControl(pt)
  local windows = hs.window.list(true)
  if type(windows) ~= "table" then return false, {} end

  local active = false
  local candidates = {}
  local x = pt and pt.x
  local y = pt and pt.y

  for _, entry in ipairs(windows) do
    local owner = entry.kCGWindowOwnerName
    local layer = entry.kCGWindowLayer
    if (owner == "WindowManager" or owner == "Dock") and type(layer) == "number" and layer >= 17 and layer < 20 then
      active = true
    elseif x and y and layer == 0 and not IGNORED_OWNERS[owner or ""] then
      local b = entry.kCGWindowBounds
      local wid = entry.kCGWindowNumber
      if type(b) == "table" and wid
        and x >= b.X and x < (b.X + b.Width)
        and y >= b.Y and y < (b.Y + b.Height) then
        candidates[#candidates + 1] = tostring(wid)
      end
    end
  end

  return active, candidates
end

local function withWindowUnderCursor(candidates, callback)
  if not candidates or #candidates == 0 then
    callback(nil)
    return
  end

  shell.task({"yabai", "-m", "query", "--windows", print_stdout = false}, function(ok, out)
    if ok and out ~= "" then
      local decodedOk, windows = pcall(hs.json.decode, out)
      if decodedOk and type(windows) == "table" then
        local valid = {}
        for _, w in ipairs(windows) do
          if type(w) == "table" and w.id ~= nil and w.role ~= "AXHelpTag" then
            valid[tostring(w.id)] = true
          end
        end
        for _, id in ipairs(candidates) do
          if valid[id] then
            callback(id)
            return
          end
        end
      end
    end

    for _, id in ipairs(candidates) do
      if hs.window.get(tonumber(id)) then
        callback(id)
        return
      end
    end

    callback(candidates[1])
  end)
end

local function closeWindowUnderCursor(candidates)
  util.log("missioncontrol: cmd+right/middle click, closing window under cursor")
  withWindowUnderCursor(candidates, function(id)
    if not id then return end
    shell.task({"yabai", "-m", "window", id, "--close"}, function(ok)
      if not ok then
        local win = hs.window.get(tonumber(id))
        if win then win:close() end
      end
    end)
  end)
end

local function toggleWindowUnderCursorInArgList(candidates)
  util.log("missioncontrol: right click, toggling window under cursor in arglist")
  withWindowUnderCursor(candidates, function(id)
    if not id then
      Preset.displayMessage("ArgList: no window under cursor")
      return
    end

    local action = ArgList.toggle(id)
    if action == "added" then ArgList.noteFocused(id) end
    local verb = action == "added" and "Marked" or "Unmarked"
    Preset.displayMessage(verb .. " window " .. id .. " (" .. ArgList.count() .. " marked)")
  end)
end

-- While Mission Control is on screen, a right click toggles the window whose
-- tile sits under the cursor in the ArgList. A middle click or Command+right
-- click closes that window. On macOS 27+, WindowManager treats right/middle
-- clicks on Mission Control tiles as window-selection clicks unless the click
-- is swallowed, and its ExposeShieldWindow sits above the tiles so yabai's
-- `mouse` selector cannot see them. We check hs.window.list(true) in-process
-- to swallow right/middle clicks while Mission Control is open and resolve the
-- tile under the cursor from its CGWindow bounds.
function M.setup()
  if _G.MissionControlMouseClick then
    pcall(function() _G.MissionControlMouseClick:stop() end)
  end

  local swallowingRight = false
  local swallowingMiddle = false

  local tap = hs.eventtap.new({
    eventTypes.rightMouseDown,
    eventTypes.rightMouseDragged,
    eventTypes.rightMouseUp,
    eventTypes.otherMouseDown,
    eventTypes.otherMouseDragged,
    eventTypes.otherMouseUp,
  }, function(event)
    local eventType = event:getType()

    if eventType == eventTypes.rightMouseDown then
      local active = inspectMissionControl(nil)
      swallowingRight = active
      return active
    elseif eventType == eventTypes.rightMouseDragged then
      return swallowingRight
    elseif eventType == eventTypes.rightMouseUp then
      local active, candidates = inspectMissionControl(event:location())
      local swallow = swallowingRight or active
      swallowingRight = false
      if active then
        local flags = event:getFlags()
        if flags.cmd then
          closeWindowUnderCursor(candidates)
        else
          toggleWindowUnderCursorInArgList(candidates)
        end
      end
      return swallow
    end

    local button = event:getProperty(eventProps.mouseEventButtonNumber)
    if button ~= 2 then return false end

    if eventType == eventTypes.otherMouseDown then
      local active = inspectMissionControl(nil)
      swallowingMiddle = active
      return active
    elseif eventType == eventTypes.otherMouseDragged then
      return swallowingMiddle
    elseif eventType == eventTypes.otherMouseUp then
      local active, candidates = inspectMissionControl(event:location())
      local swallow = swallowingMiddle or active
      swallowingMiddle = false
      if active then
        closeWindowUnderCursor(candidates)
      end
      return swallow
    end

    return false
  end)

  tap:start()
  _G.MissionControlMouseClick = tap
  _G.MissionControlRightClick = tap
end

return M
