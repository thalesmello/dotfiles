-- arglist.lua
-- Manages a global list of marked window ids (the "arglist") so that a single
-- action can operate on many windows at once (e.g. send all marked windows to a
-- workspace).
--
-- The backing store is hs.settings, i.e. the user defaults plist: filewatcher.lua
-- reloads the config on every edit, which rebuilds the Lua state, so an in-memory
-- table alone would drop the marks constantly. `list` below is the working copy;
-- every mutation writes through to hs.settings. Ids are strings.

local M = {}

local SETTINGS_KEY = "arglist"

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

function M.items()
  return list
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
  save()
end

return M
