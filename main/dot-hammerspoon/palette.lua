local M = {}

local allBindings = {}

function M.registerBinding(name, fn)
  table.insert(allBindings, {name = name, fn = fn})
end

function M.showCommandPalette()
  local choices = {}
  for i, binding in ipairs(allBindings) do
    choices[i] = {text = binding.name, index = i}
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
