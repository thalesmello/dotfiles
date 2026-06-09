local M = {}

local allBindings = {}

function M.registerBinding(name, fn, shortcut)
  table.insert(allBindings, {name = name, fn = fn, shortcut = shortcut})
end

function M.showCommandPalette()
  local choices = {}
  for i, binding in ipairs(allBindings) do
    local text = binding.name
    if binding.shortcut and binding.shortcut ~= "" then
      text = text .. " (" .. binding.shortcut .. ")"
    end
    choices[i] = {text = text, index = i}
  end
  local chooser = hs.chooser.new(function(choice)
    if choice then
      local binding = allBindings[choice.index]
      if binding and binding.fn then binding.fn() end
    end
  end)
  chooser:choices(choices)
  chooser:show()
end

return M
