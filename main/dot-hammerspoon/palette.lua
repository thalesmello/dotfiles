local M = {}

-- Bindings keyed by a unique string. A shortcut string uniquely identifies a
-- physical chord (mode + mods + key), so keying on it means a later binding for
-- the same chord (e.g. local config overriding a main binding) overwrites the
-- earlier one in O(1). The palette then reflects what actually fires instead of
-- showing the stale binding too.
local bindings = {}

-- Counter for bindings registered without a shortcut, so each still gets a
-- unique key instead of collapsing into one another.
local anonCount = 0

function M.registerBinding(name, fn, shortcut)
  local key
  if shortcut and shortcut ~= "" then
    key = shortcut
  else
    anonCount = anonCount + 1
    key = "\0anon:" .. anonCount
  end
  bindings[key] = {name = name, fn = fn, shortcut = shortcut}
end

function M.showCommandPalette()
  -- hs.chooser can only bridge plain values (strings/numbers) onto choices, so
  -- we stash the dictionary key on each choice and resolve the fn on selection.
  local choices = {}
  for key, binding in pairs(bindings) do
    local text = binding.name
    if binding.shortcut and binding.shortcut ~= "" then
      text = text .. " (" .. binding.shortcut .. ")"
    end
    choices[#choices + 1] = {text = text, key = key}
  end
  local chooser = hs.chooser.new(function(choice)
    if choice then
      local binding = bindings[choice.key]
      if binding and binding.fn then binding.fn() end
    end
  end)
  chooser:choices(choices)
  chooser:show()
end

return M
