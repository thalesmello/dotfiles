local palette = require("palette")

local M = {}

function M.frontAppName()
  local app = hs.application.frontmostApplication()
  return app and app:name() or ""
end

function M.isFloatingTerminal()
  local win = hs.window.focusedWindow()
  if not win then return false end
  local app = win:application()
  return app ~= nil and app:name() == "iTerm2" and win:title():find("floating-terminal", 1, true) ~= nil
end

local Mode = {}
Mode.__index = Mode
M.Mode = Mode

function Mode:bindOnce(mods, key, name, fn)
  if self._modal then
    self._modal:bind(mods, key, function() self._modal:exit(); fn() end)
  else
    hs.hotkey.bind(mods, key, fn)
  end
  palette.registerBinding(self._prefix .. name, fn)
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
  return setmetatable({_modal = modal, _prefix = prefix or ""}, Mode)
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
