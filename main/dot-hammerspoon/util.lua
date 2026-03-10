local M = {}
M.DEBUG = false
local logger = hs.logger.new('log', 'debug')
function M.as_list(list)
  if type(list) ~= 'table' then
    list = { list }
  end

  return list
end

function M.currentWindowInList (listOfPrograms)
  local activeWindowName = hs.window.focusedWindow():application()
  for _, currentName in ipairs (listOfPrograms) do

      if currentName == activeWindowName then
          return true
      end
  end

  return false
end

function M.except(listOfPrograms, callback)
  listOfPrograms = M.as_list(listOfPrograms)

  return function(hotkey, mods, key)
    if M.currentWindowInList(listOfPrograms) then
      hotkey:disable()
      hs.eventtap.keyStroke(mods, key)
      hotkey:enable()
    else
      callback()
    end
  end
end
-- Example:
-- nonRecursiveBind({"ctrl"}, "H", except({ "iTerm2", "RStudio" }, function() hs.window.focusedWindow():focusWindowWest()  end))

function M.only(listOfPrograms, callback)
  listOfPrograms = M.as_list(listOfPrograms)

  return function(hotkey, mods, key)
    if M.currentWindowInList(listOfPrograms) then
      callback()
    else
      hotkey:disable()
      hs.eventtap.keyStroke(mods, key)
      hotkey:enable()
    end
  end
end

-- Example
-- -- nonRecursiveBind({"alt"}, "delete", only({ "iTerm2" }, function() quickKeyStroke({"ctrl"}, "W")  end))

function M.table_print (tt, indent, done)
  done = done or {}
  indent = indent or 0
  if type(tt) == "table" then
    local sb = {}
    for key, value in pairs (tt) do
      table.insert(sb, string.rep (" ", indent)) -- indent it
      if type (value) == "table" and not done [value] then
        done [value] = true
        table.insert(sb, "{\n");
        table.insert(sb, M.table_print (value, indent + 2, done))
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

function M.to_string( tbl )
    if  "nil"       == type( tbl ) then
        return tostring(nil)
    elseif  "table" == type( tbl ) then
        return M.table_print(tbl)
    elseif  "string" == type( tbl ) then
        return tbl
    else
        return tostring(tbl)
    end
end

local function _smartInspect(obj, indent, seen)
  if type(obj) == "string" then return string.format("%q", obj) end
  if obj == nil then return "nil" end

  if type(obj) == "userdata" then
    local ok, desc

    -- hs.window
    ok, desc = pcall(function()
      local id = obj:id()
      local title = obj:title()
      local frame = obj:frame()
      local app = obj:application()
      return string.format("hs.window { id=%s, title=%q, app=%q, frame=%s }",
        tostring(id), title or "", app and app:name() or "?", tostring(frame))
    end)
    if ok and desc then return desc end

    -- hs.application
    ok, desc = pcall(function()
      local name = obj:name()
      local bid = obj:bundleID()
      local pid = obj:pid()
      return string.format("hs.application { name=%q, bundleID=%q, pid=%s }",
        name or "?", bid or "?", tostring(pid))
    end)
    if ok and desc then return desc end

    -- hs.screen
    ok, desc = pcall(function()
      local name = obj:name()
      local id = obj:id()
      local frame = obj:fullFrame()
      obj:currentMode()
      return string.format("hs.screen { name=%q, id=%s, frame=%s }",
        name or "?", tostring(id), tostring(frame))
    end)
    if ok and desc then return desc end

    return tostring(obj)
  end

  if type(obj) == "table" then
    if seen[obj] then return "<circular>" end
    seen[obj] = true
    local parts = {}
    local prefix = string.rep("  ", indent + 1)

    for k, v in pairs(obj) do
      local key = type(k) == "string" and k or "[" .. tostring(k) .. "]"
      parts[#parts + 1] = prefix .. key .. " = " .. _smartInspect(v, indent + 1, seen)
    end

    if #parts == 0 then return "{}" end
    if #parts == 1 and not parts[1]:find("\n") then
      return "{ " .. parts[1]:match("^%s*(.+)") .. " }"
    end
    return "{\n" .. table.concat(parts, ",\n") .. "\n" .. string.rep("  ", indent) .. "}"
  end

  return tostring(obj)
end

function M.smartInspect(obj)
  return _smartInspect(obj, 0, {})
end

function M.log(...)
  if not M.DEBUG then return end
  local args = table.pack(...)
  local parts = {}
  for i = 1, args.n do
    parts[i] = M.smartInspect(args[i])
  end
  logger:d('\n' .. table.concat(parts, " "))
end

function M.notify(str)
  hs.alert.show(str)
end

function M.minutesToHours(minutes)
  if minutes <= 0 then
    return "0:00";
  else
    local hours = string.format("%d", math.floor(minutes / 60))
    local mins = string.format("%02.f", math.floor(minutes - (hours * 60)))
    return string.format("%s:%s", hours, mins)
  end
end


function M.quickKeyStroke (modifiers, character)
    local event = require("hs.eventtap").event
    event.newKeyEvent(modifiers, string.lower(character), true):post()
    event.newKeyEvent(modifiers, string.lower(character), false):post()
end

function M.quickSystemStroke (key)
    hs.eventtap.event.newSystemKeyEvent(key, true):post()
    hs.eventtap.event.newSystemKeyEvent(key, false):post()
end


function M.nonRecursiveBind(mods, key, callback)
  local hotkey
  hotkey = hs.hotkey.bind(mods, key, function()
    callback(hotkey, mods, key)
  end)
end

return M
