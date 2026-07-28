local palette = require("palette")

local M = {}

function M.frontAppName()
  local app = hs.application.frontmostApplication()
  return app and app:name() or ""
end

local Mode = {}
Mode.__index = Mode
M.Mode = Mode

local HYPER = "✦"

local modSymbols = {
  cmd = "⌘", command = "⌘",
  alt = "⌥", option = "⌥", opt = "⌥",
  ctrl = "⌃", control = "⌃",
  shift = "⇧",
  fn = "fn",
}

-- canonical name -> display symbol, in display order
local modOrder = {"hyper", "ctrl", "alt", "cmd", "shift", "fn"}

local function normalize(mod)
  local m = mod:lower()
  if m == "command" then return "cmd" end
  if m == "option" or m == "opt" then return "alt" end
  if m == "control" then return "ctrl" end
  return m
end

local function formatShortcut(mods, key)
  local present = {}
  if type(mods) == "table" then
    for _, mod in ipairs(mods) do present[normalize(mod)] = true end
  elseif type(mods) == "string" and mods ~= "" then
    present[normalize(mods)] = true
  end

  -- collapse ctrl+alt+cmd into a single hyper modifier
  if present.ctrl and present.alt and present.cmd then
    present.ctrl, present.alt, present.cmd = nil, nil, nil
    present.hyper = true
  end

  local parts = {}
  for _, name in ipairs(modOrder) do
    if present[name] then
      parts[#parts + 1] = (name == "hyper") and HYPER or modSymbols[name]
    end
  end
  parts[#parts + 1] = key
  return table.concat(parts, "")
end

-- The prefix shown in the palette for bindings in this mode, e.g.
-- "✦Space [Service] > ". Built by walking up the chain of modes that enter
-- this one. The default (modeless) mode has no _name and returns "".
function Mode:displayPrefix()
  if not self._name then return "" end
  local parent = self._enterFrom and self._enterFrom:displayPrefix() or ""
  local chord = self._enterChord or "?"
  return parent .. chord .. " [" .. self._name .. "] > "
end

function Mode:bindOnce(mods, key, name, fn)
  if self._modal then
    self._modal:bind(mods, key, function() self._modal:exit(); fn() end)
  else
    hs.hotkey.bind(mods, key, fn)
  end
  local shortcut = self:displayPrefix() .. formatShortcut(mods, key)
  palette.registerBinding(name, fn, shortcut)
end

-- Bind a key in `self` that enters `targetMode`, and record how the target is
-- reached so its bindings can show the full "✦Space [Service] > ..." path.
-- Keeps the first entry point registered when a mode is reachable from several.
function Mode:bindEnter(mods, key, name, targetMode)
  self:bindOnce(mods, key, name, function() targetMode:enter() end)
  if not targetMode._enterChord then
    targetMode._enterFrom = self
    targetMode._enterChord = formatShortcut(mods, key)
  end
end

function Mode:bind(mods, key, fn)
  if self._modal then
    self._modal:bind(mods, key, fn)
  else
    hs.hotkey.bind(mods, key, fn)
  end
end

local function _makeRulesEvalFunc(rules)
  local function eval(i)
    if i == nil then
      i = 1
    elseif i > #rules then
      return
    end

    local app = M.frontAppName()
    local rule = rules[i]
    local appMatch = not rule.app or rule.app == app
    local condMatch = true
    local operate = function(callback)
      callback(condMatch)
    end

    if rule.cond then
      local result = rule.cond()

      if type(result) == "function" then
        operate = result
      else
        condMatch = result
      end
    end

    operate(function (condMatch)
      if appMatch and condMatch then
        rule[1]()
      else
        eval(i + 1)
      end
    end
    )
  end

  return eval
end

function Mode:conditionalBind(mods, key, rules)
  self:bind(mods, key, _makeRulesEvalFunc(rules))
end

function Mode:conditionalBindOnce(mods, key, name, rules)
  self:bindOnce(mods, key, name, _makeRulesEvalFunc(rules))
end

function Mode:enter()
  if self._modal then self._modal:enter() end
end

function Mode:exit()
  if self._modal then self._modal:exit() end
end

function M.createModal(name, prefix)
  local modal = hs.hotkey.modal.new()
  local alertUUID = nil
  function modal:entered()
    if name then alertUUID = hs.alert.show(name, true) end
  end
  function modal:exited()
    if alertUUID then hs.alert.closeSpecific(alertUUID) end
    alertUUID = nil
  end
  modal:bind({}, "escape", function() modal:exit() end)
  -- Bracket label for the palette: prefer the alert name, else derive it from
  -- the prefix (e.g. "Service: " -> "Service").
  local modeName = name
  if not modeName and prefix and prefix ~= "" then
    modeName = prefix:gsub("[:%s]+$", "")
  end
  return setmetatable({_modal = modal, _prefix = prefix or "", _name = modeName}, Mode)
end

function M.createAppModal(appName)
  local modal = hs.hotkey.modal.new()
  local watcher = hs.application.watcher.new(function(name, event)
    if event == hs.application.watcher.activated then
      if name == appName then modal:enter() else modal:exit() end
    end
  end)
  watcher:start()
  modal._appWatcher = watcher
  if M.frontAppName() == appName then modal:enter() end
  return modal
end

return M
