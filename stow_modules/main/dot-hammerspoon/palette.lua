local M = {}

-- Shortcut keys retain override precedence; anonymous and dynamic entries get
-- separate namespaces. Registry keys never cross the native chooser bridge.
local bindings = {}
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

-- Resolve a state-dependent command each time the palette opens. Returning nil
-- hides the entry. A stable id replaces earlier registration, without private
-- table introspection or fake shortcut labels.
function M.registerDynamicBinding(id, resolve)
  assert(type(id) == "string" and type(resolve) == "function")
  bindings["\0dynamic:" .. id] = {resolve = resolve}
end

function M.showCommandPalette()
  local choices, actions = {}, {}
  for _, entry in pairs(bindings) do
    local binding = entry.resolve and entry.resolve() or entry
    if binding and binding.name and binding.fn then
      local text = binding.name
      if binding.shortcut and binding.shortcut ~= "" then
        text = text .. " (" .. binding.shortcut .. ")"
      end
      local id = #choices + 1
      choices[id] = {text = text, choiceId = id}
      -- Snapshot the exact action shown, so a state change while the chooser
      -- is open cannot turn a displayed Disable command into Enable.
      actions[id] = binding.fn
    end
  end
  local completed = false
  local chooser = hs.chooser.new(function(choice)
    if completed then return end
    completed = true
    local action = choice and actions[choice.choiceId]
    if action then action() end
  end)
  chooser:choices(choices)
  chooser:show()
  return chooser
end

return M
