-- arglist.lua
-- Manages a global list of marked window ids (the "arglist") so that a single
-- action can operate on many windows at once (e.g. send all marked windows to a
-- workspace). The backing store lives on _G._ArgList so it survives garbage
-- collection and persists across config reloads.

local M = {}

_G._ArgList = _G._ArgList or {}

function M.items()
  return _G._ArgList
end

function M.count()
  return #_G._ArgList
end

function M.isEmpty()
  return #_G._ArgList == 0
end

function M.contains(id)
  for _, v in ipairs(_G._ArgList) do
    if v == id then return true end
  end
  return false
end

-- Adds id if it is absent. Returns true if it was added, false if already present.
function M.add(id)
  if M.contains(id) then return false end
  table.insert(_G._ArgList, id)
  return true
end

-- Adds id if it is absent, removes it if it is already present.
-- Returns "added" or "removed".
function M.toggle(id)
  local list = _G._ArgList
  for i, v in ipairs(list) do
    if v == id then
      table.remove(list, i)
      return "removed"
    end
  end
  table.insert(list, id)
  return "added"
end

-- Returns the id `delta` steps away from `currentId` in the list, wrapping
-- around the ends. If `currentId` is not in the list, returns the first element
-- when moving forward or the last when moving backward. Returns nil if empty.
function M.relative(currentId, delta)
  local list = _G._ArgList
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
  -- Replace in place so external references to the table stay valid while still
  -- clearing the global store.
  local list = _G._ArgList
  for i = #list, 1, -1 do
    list[i] = nil
  end
end

return M
