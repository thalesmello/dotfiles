-- arglist.lua
-- Manages a global list of marked window ids (the "arglist") so that a single
-- action can operate on many windows at once (e.g. send all marked windows to a
-- workspace).
--
-- The backing store is hs.settings, i.e. the user defaults plist: filewatcher.lua
-- reloads the config on every edit, which rebuilds the Lua state, so an in-memory
-- table alone would drop the marks constantly. `list` below is the working copy;
-- every mutation writes through to hs.settings. Ids are strings.

local shell = require("shell")
local a = require("async")
local Preset = require("preset")
local FocusHistory = require("focushistory")

local taskAsync = shell.taskAsync
local taskAllAsync = shell.taskAllAsync

local M = {}

local SETTINGS_KEY = "arglist"
local LAST_FOCUSED_KEY = "arglist.lastFocused"

local list = {}
do
  local saved = hs.settings.get(SETTINGS_KEY)
  if type(saved) == "table" then
    for _, v in ipairs(saved) do
      if type(v) == "string" then list[#list + 1] = v end
    end
  end
end

local function save()
  hs.settings.set(SETTINGS_KEY, list)
end

local lastFocused = hs.settings.get(LAST_FOCUSED_KEY)
if type(lastFocused) ~= "string" then lastFocused = nil end

local function saveLastFocused()
  hs.settings.set(LAST_FOCUSED_KEY, lastFocused)
end

function M.items()
  return list
end

-- Copy the arglist, optionally moving `lastId` to the end. Useful for callers
-- that want to operate on every marked window while giving the MRU window a
-- final pass afterward.
function M.itemsWithLast(lastId)
  lastId = lastId and tostring(lastId) or nil
  local ids = {}
  local appendLast = false
  for _, id in ipairs(list) do
    if lastId and id == lastId then
      appendLast = true
    else
      ids[#ids + 1] = id
    end
  end
  if appendLast then ids[#ids + 1] = lastId end
  return ids
end

function M.count()
  return #list
end

function M.isEmpty()
  return #list == 0
end

function M.contains(id)
  for _, v in ipairs(list) do
    if v == id then return true end
  end
  return false
end

-- Remember which marked window should be considered most-recent. This is used
-- by the arglist show/hide toggle so restoring the group can land back on the
-- window that was active before the group was minimized.
function M.noteFocused(id)
  id = tostring(id or "")
  if id == "" or not M.contains(id) then return false end
  lastFocused = id
  saveLastFocused()
  return true
end

function M.lastFocused()
  if lastFocused and M.contains(lastFocused) then return lastFocused end
  return nil
end

local function windowId(win)
  local id = win and win:id()
  return id and tostring(id) or nil
end

function M.focusedWindowId()
  local id = windowId(hs.window.focusedWindow())
  if id and M.contains(id) then return id end
  return nil
end

function M.topmostWindowId()
  for _, win in ipairs(hs.window.orderedWindows()) do
    local id = windowId(win)
    if id and M.contains(id) then return id end
  end
  return nil
end

function M.topmostExternalWindowId()
  for _, win in ipairs(hs.window.orderedWindows()) do
    local id = windowId(win)
    if id and not M.contains(id) then return id end
  end
  return nil
end

function M.mostRecentWindowId()
  local id = M.focusedWindowId()
  if id then return id end

  -- Visible windows are ordered front-to-back, which is the most accurate MRU
  -- signal when the arglist is merely behind another app instead of minimized.
  id = M.topmostWindowId()
  if id then return id end

  -- When the group was hidden through this toggle, the focused arglist window
  -- may not have dwelled long enough to enter FocusHistory. Prefer the explicit
  -- note from the hide path, then fall back to the longer-lived history stack.
  id = M.lastFocused()
  if id then return id end

  id = FocusHistory.mostRecentWindowIdWhere(function(windowId) return M.contains(windowId) end)
  if id then return id end

  return list[#list]
end

function M.toggleWindows()
  if M.isEmpty() then
    Preset.displayMessage("ArgList: empty")
    return
  end

  local focusedId = M.focusedWindowId()
  if focusedId then
    M.noteFocused(focusedId)
    local ids = M.itemsWithLast()
    a.sync(function()
      -- Focus a safe non-arglist window first, then minimize every arglist
      -- window in parallel, including the one that was focused.
      local fallback = M.topmostExternalWindowId()
      if fallback then a.wait(taskAsync({"wm-preset", "focus-window-id", fallback})) end

      local bulk = {}
      for _, id in ipairs(ids) do
        bulk[#bulk + 1] = {"wm-preset", "minimize", "--no-message", id}
      end
      local minimized = a.wait(taskAllAsync(bulk))
      Preset.displayMessage("ArgList: minimized " .. minimized .. " / " .. #ids)
    end)()
    return
  end

  local target = M.mostRecentWindowId()
  local ids = M.itemsWithLast(target)
  a.sync(function()
    -- Raise/focus every arglist window in parallel, including the MRU one, then
    -- focus the MRU target once more at the end so it is left active.
    local bulk = {}
    for _, id in ipairs(ids) do
      bulk[#bulk + 1] = {"wm-preset", "focus-window-id", id}
    end
    local focused = a.wait(taskAllAsync(bulk))
    if target then
      local ok = a.wait(taskAsync({"wm-preset", "focus-window-id", target}))
      if ok then M.noteFocused(target) end
    end
    Preset.displayMessage("ArgList: focused " .. focused .. " / " .. #ids)
  end)()
end

-- Returns the 1-based position of id in the list, or nil if absent.
function M.indexOf(id)
  for i, v in ipairs(list) do
    if v == id then return i end
  end
  return nil
end

-- Adds id if it is absent. Returns true if it was added, false if already present.
function M.add(id)
  if M.contains(id) then return false end
  table.insert(list, id)
  save()
  return true
end

-- Adds id if it is absent, removes it if it is already present.
-- Returns "added" or "removed".
function M.toggle(id)
  for i, v in ipairs(list) do
    if v == id then
      table.remove(list, i)
      if lastFocused == id then
        lastFocused = nil
        saveLastFocused()
      end
      save()
      return "removed"
    end
  end
  table.insert(list, id)
  save()
  return "added"
end

-- Returns the id `delta` steps away from `currentId` in the list, wrapping
-- around the ends. If `currentId` is not in the list, returns the first element
-- when moving forward or the last when moving backward. Returns nil if empty.
function M.relative(currentId, delta)
  local n = #list
  if n == 0 then return nil end

  local idx
  for i, v in ipairs(list) do
    if v == currentId then idx = i; break end
  end
  if not idx then
    return delta >= 0 and list[1] or list[n]
  end

  return list[((idx - 1 + delta) % n) + 1]
end

function M.clear()
  -- Empty in place so external references to the table (M.items) stay valid.
  for i = #list, 1, -1 do
    list[i] = nil
  end
  lastFocused = nil
  saveLastFocused()
  save()
end

return M
