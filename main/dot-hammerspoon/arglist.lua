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

function M.clear()
  -- Replace in place so external references to the table stay valid while still
  -- clearing the global store.
  local list = _G._ArgList
  for i = #list, 1, -1 do
    list[i] = nil
  end
end

return M
