-- keybindings.lua - Hammerspoon keybindings (replaces skhd)

local FISH = "/opt/homebrew/bin/fish"
local util = require("util")
local a = require("async")

-- Fetch PATH from fish once at startup
local _pathDirs = {}
do
  local output = hs.execute(FISH .. " -lc 'printf \"%s\\n\" $PATH'")
  if output then
    for dir in output:gmatch("[^\n]+") do
      _pathDirs[#_pathDirs + 1] = dir
    end
  end
end

-- Memoized binary resolution
local _resolvedPaths = {}
local function resolvePath(binaryName)
  if _resolvedPaths[binaryName] then return _resolvedPaths[binaryName] end
  if binaryName:sub(1, 1) == "/" then
    _resolvedPaths[binaryName] = binaryName
    return binaryName
  end
  for _, dir in ipairs(_pathDirs) do
    local fullPath = dir .. "/" .. binaryName
    if hs.fs.attributes(fullPath, "mode") then
      _resolvedPaths[binaryName] = fullPath
      return fullPath
    end
  end
  util.log("resolvePath: not found:", binaryName)
  return nil
end

-- Modifier shorthands (matching skhd's ctrl + alt + cmd)
local hyper = {"ctrl", "alt", "cmd"}
local hyperShift = {"ctrl", "alt", "cmd", "shift"}

---------------------------------------------------------------
-- Helper functions
---------------------------------------------------------------

-- Prevent hs.task objects from being garbage-collected before their callback fires
local _runningTasks = {}

-- Async (fire-and-forget) shell command via fish
local function fish(cmd)
  util.log("fish:", cmd)
  local task
  task = hs.task.new(FISH, function(exitCode, stdOut, stdErr)
    _runningTasks[task] = nil
    if stdOut and #stdOut > 0 then util.log("fish stdout:", stdOut) end
    if stdErr and #stdErr > 0 then util.log("fish stderr:", stdErr) end
  end, {"-c", cmd})
  _runningTasks[task] = true
  task:start()
end

-- Async shell command that can be awaited — returns (success, output)
local fishAsync = a.wrap(function(cmd, callback)
  util.log("fishAsync:", cmd)
  local task
  task = hs.task.new(FISH, function(exitCode, stdOut, stdErr)
    _runningTasks[task] = nil
    util.log("fishAsync result: exitCode=", exitCode, "stdout=", stdOut)
    callback(exitCode == 0, (stdOut or ""):gsub("%s+$", ""))
  end, {"-c", cmd})
  _runningTasks[task] = true
  task:start()
end)

-- Fire-and-forget direct binary execution
local function task(args)
  local resolvedPath = resolvePath(args[1])
  if not resolvedPath then return end
  local taskArgs = {table.unpack(args, 2)}
  util.log("task:", resolvedPath, table.unpack(taskArgs))
  local t
  t = hs.task.new(resolvedPath, function(exitCode, stdOut, stdErr)
    _runningTasks[t] = nil
    if stdOut and #stdOut > 0 then util.log("task stdout:", stdOut) end
    if stdErr and #stdErr > 0 then util.log("task stderr:", stdErr) end
  end, taskArgs)
  _runningTasks[t] = true
  t:start()
end

-- Awaitable direct binary execution — returns (success, output)
local taskAsync = a.wrap(function(args, callback)
  local resolvedPath = resolvePath(args[1])
  if not resolvedPath then callback(false, ""); return end
  local taskArgs = {table.unpack(args, 2)}
  util.log("taskAsync:", resolvedPath, table.unpack(taskArgs))
  local t
  t = hs.task.new(resolvedPath, function(exitCode, stdOut, stdErr)
    _runningTasks[t] = nil
    util.log("taskAsync result: exitCode=", exitCode, "stdout=", stdOut)
    callback(exitCode == 0, (stdOut or ""):gsub("%s+$", ""))
  end, taskArgs)
  _runningTasks[t] = true
  t:start()
end)

-- Get frontmost application name
local function frontAppName()
  local app = hs.application.frontmostApplication()
  return app and app:name() or ""
end

-- Check if a process is running using pgrep (returns a taskAsync thunk)
local function isProcessRunning(name)
  return taskAsync({"pgrep", "-x", name})
end

-- Check if the focused window is a floating terminal (pure Lua, no subprocess)
local function isFloatingTerminal()
  local win = hs.window.focusedWindow()
  if not win then return false end
  local app = win:application()
  return app ~= nil and app:name() == "iTerm2" and win:title() == "floating-terminal"
end

-- Check if the current window is floating in the WM (needs shell — no HS API for tiling state)
local function isWindowFloating()
  return taskAsync({"wm-preset", "is-window-floating"})
end

---------------------------------------------------------------
-- Command palette
---------------------------------------------------------------

local allBindings = {}

local function registerBinding(name, fn)
  table.insert(allBindings, {name = name, fn = fn})
end

local function showCommandPalette()
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

---------------------------------------------------------------
-- Mode system
---------------------------------------------------------------

local Mode = {}
Mode.__index = Mode

function Mode:bindOnce(mods, key, name, fn)
  if self._modal then
    self._modal:bind(mods, key, function() self._modal:exit(); fn() end)
  else
    hs.hotkey.bind(mods, key, fn)
  end
  registerBinding(self._prefix .. name, fn)
end

function Mode:bind(mods, key, fn)
  if self._modal then
    self._modal:bind(mods, key, fn)
  else
    hs.hotkey.bind(mods, key, fn)
  end
end

local function _makeRulesEvalFunc(rules)
  return function()
    local app = frontAppName()
      for _, rule in ipairs(rules) do
        local appMatch = not rule.app or rule.app == app
        local condMatch = true
        if rule.cond then
          local result = rule.cond()
          if type(result) == "function" then
            condMatch = a.sync(function () a.wait(result) end)()
          else
            condMatch = result
          end
        end
        if appMatch and condMatch then
          rule[1]()
          return
        end
      end
  end
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

local function createModal(name, prefix)
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

local default   = setmetatable({_prefix = ""}, Mode)
local service   = createModal(nil, "Service: ")
local chrome    = createModal("Chrome", "Chrome: ")
local goto_mode = createModal("Go To", "Go To: ")
local invoke    = createModal("Invoke", "Invoke: ")
local resize    = createModal("Resize", "")
local restart   = createModal("Restart", "Restart: ")

---------------------------------------------------------------
-- Local config
---------------------------------------------------------------

local home = os.getenv("HOME")
local local_dotfiles = home .. "/.local_dotfiles"
package.path = local_dotfiles .. "/local_hammerspoon/?.lua;"
    .. local_dotfiles .. "/local_hammerspoon/?/init.lua;"
    .. package.path
local ok, localConfig = pcall(dofile, local_dotfiles .. "/local_hammerspoon/keybindings.lua")

---------------------------------------------------------------
-- Smart Cmd+Tab
---------------------------------------------------------------

local cmdTabCount = 0
local floatingTerminalJustHidden = false
local windowAfterHide = nil

local cmdTabTap = hs.eventtap.new(
  {hs.eventtap.event.types.keyDown, hs.eventtap.event.types.flagsChanged},
  function(event)
    local type = event:getType()
    local flags = event:getFlags()

    -- On Cmd release: reset counter
    if type == hs.eventtap.event.types.flagsChanged then
      if not flags.cmd then
        cmdTabCount = 0
      end
      return false  -- never consume modifier events
    end

    -- Only intercept Tab while Cmd is held (no other modifiers)
    local keyCode = event:getKeyCode()
    if keyCode ~= hs.keycodes.map["tab"] then return false end
    if not flags.cmd then return false end
    if flags.alt or flags.ctrl or flags.shift then return false end

    cmdTabCount = cmdTabCount + 1

    if cmdTabCount == 1 then
      -- First press: custom behavior
      local focusedWin = hs.window.focusedWindow()
      local focusedWinId = focusedWin and focusedWin:id()
      if floatingTerminalJustHidden and windowAfterHide and focusedWinId == windowAfterHide then
        -- Terminal was just hidden and user hasn't switched windows → reopen
        floatingTerminalJustHidden = false
        windowAfterHide = nil
        hs.eventtap.keyStroke(hyper, "/", 0)
      elseif isFloatingTerminal() then
        -- Only hide hotkey window when floating terminal is actually focused
        floatingTerminalJustHidden = true
        windowAfterHide = nil
        hs.osascript.applescript('tell application "iTerm2" to hide hotkey window current window')
        hs.timer.doAfter(0.3, function()
          local win = hs.window.focusedWindow()
          windowAfterHide = win and win:id()
        end)
      else
        floatingTerminalJustHidden = false
        windowAfterHide = nil
        task({"wm-preset", "focus-recent"})
      end
      return true  -- consume the event
    else
      -- Second+ press: let native App Switcher handle it
      return false
    end
  end
)
cmdTabTap:start()

---------------------------------------------------------------
-- DEFAULT MODE bindings
---------------------------------------------------------------

-- Command palette
default:bindOnce(hyperShift, ";", "Command Palette", showCommandPalette)

-- Utility
default:bindOnce(hyperShift, "m", "Deminimize Last", function() task({"wm-preset", "deminimize-last"}) end)
default:bindOnce(hyper, "m", "Minimize", function() task({"wm-preset", "minimize"}) end)
default:bindOnce(hyper, "return", "Smart Toggle Fullscreen", function() task({"wm-preset", "smart-toggle-fullscreen"}) end)
default:bindOnce(hyperShift, "return", "Unstacked Swap Largest", function() task({"wm-preset", "unstacked-swap-largest"}) end)

-- Neovide
default:bindOnce(hyper, "v", "Neovide Toggle", function() Preset.alternateApp("Neovide", {hide = true, cmd = "neovim-ghost trigger"}) end)
default:bindOnce(hyper, "t", "Chrome: New Tab and Focus", function() fish('chrome-cli open -t; open -a "Google Chrome"') end)

-- Space navigation
default:bindOnce(hyper, "[", "Focus Space Prev", function() task({"wm-preset", "focus-space", "prev"}) end)
default:bindOnce(hyper, "]", "Focus Space Next", function() task({"wm-preset", "focus-space", "next"}) end)

-- Window focus HJKL
default:bindOnce(hyper, "h", "Focus Window West", function() fish("wm-preset focus-window west; or wm-preset focus-floating-window west") end)
default:bindOnce(hyper, "j", "Focus Window South", function() fish("wm-preset focus-window south; or wm-preset focus-floating-window south") end)
default:bindOnce(hyper, "k", "Focus Window North", function() fish("wm-preset focus-window north; or wm-preset focus-floating-window north") end)
default:bindOnce(hyper, "l", "Focus Window East", function() fish("wm-preset focus-window east; or wm-preset focus-floating-window east") end)

-- Window swap/snap HJKL
default:conditionalBindOnce(hyperShift, "h", "Swap/Snap West", {
  {cond = isWindowFloating, function() task({"yabai-preset", "snap", "west"}) end},
  {function() task({"wm-preset", "swap-window", "west"}) end},
})
default:conditionalBindOnce(hyperShift, "j", "Swap/Snap South", {
  {cond = isWindowFloating, function() task({"yabai-preset", "snap", "south"}) end},
  {function() task({"wm-preset", "swap-window", "south"}) end},
})
default:conditionalBindOnce(hyperShift, "k", "Swap/Snap North", {
  {cond = isWindowFloating, function() task({"yabai-preset", "snap", "north"}) end},
  {function() task({"wm-preset", "swap-window", "north"}) end},
})
default:conditionalBindOnce(hyperShift, "l", "Swap/Snap East", {
  {cond = isWindowFloating, function() task({"yabai-preset", "snap", "east"}) end},
  {function() task({"wm-preset", "swap-window", "east"}) end},
})

-- Ctrl+Cmd HJKL (per-app, Chrome tab nav)
local isFloating = isFloatingTerminal

default:conditionalBind({"ctrl", "cmd"}, "h", {
  {app = "Google Chrome", cond = isFloating, function() hs.eventtap.keyStroke({"alt", "cmd"}, "left") end},
  {app = "Google Chrome", function() hs.eventtap.keyStroke({"ctrl", "shift"}, "tab") end},
  {function() hs.eventtap.keyStroke({"alt", "cmd"}, "left") end},
})
default:conditionalBind({"ctrl", "cmd"}, "j", {
  {app = "Google Chrome", cond = isFloating, function() hs.eventtap.keyStroke({"alt", "cmd"}, "down") end},
  {app = "Google Chrome", function() hs.eventtap.keyStroke({"cmd"}, "9") end},
  {function() hs.eventtap.keyStroke({"alt", "cmd"}, "down") end},
})
default:conditionalBind({"ctrl", "cmd"}, "k", {
  {app = "Google Chrome", cond = isFloating, function() hs.eventtap.keyStroke({"alt", "cmd"}, "up") end},
  {app = "Google Chrome", function() hs.eventtap.keyStroke({"cmd"}, "1") end},
  {function() hs.eventtap.keyStroke({"alt", "cmd"}, "up") end},
})
default:conditionalBind({"ctrl", "cmd"}, "l", {
  {app = "Google Chrome", cond = isFloating, function() hs.eventtap.keyStroke({"alt", "cmd"}, "right") end},
  {app = "Google Chrome", function() hs.eventtap.keyStroke({"ctrl"}, "tab") end},
  {function() hs.eventtap.keyStroke({"alt", "cmd"}, "right") end},
})

-- Shift+Ctrl+Cmd HJKL (per-app)
default:conditionalBind({"shift", "ctrl", "cmd"}, "h", {
  {app = "Google Chrome", cond = isFloating, function() hs.eventtap.keyStroke({"ctrl", "cmd"}, "left") end},
  {app = "Google Chrome", function() hs.eventtap.keyStroke({"ctrl", "shift"}, "h") end},
  {app = "iTerm2", function() hs.eventtap.keyStroke({"ctrl", "cmd"}, "left") end},
  {cond = isFloating, function() hs.eventtap.keyStroke({"ctrl", "cmd"}, "left") end},
  {function() hs.eventtap.keyStroke({"shift", "alt", "cmd"}, "left") end},
})
default:conditionalBind({"shift", "ctrl", "cmd"}, "j", {
  {app = "Google Chrome", cond = isFloating, function() hs.eventtap.keyStroke({"ctrl", "cmd"}, "down") end},
  {app = "Google Chrome", function() hs.eventtap.keyStroke({"ctrl", "shift"}, "j") end},
  {app = "iTerm2", function() hs.eventtap.keyStroke({"ctrl", "cmd"}, "down") end},
  {cond = isFloating, function() hs.eventtap.keyStroke({"ctrl", "cmd"}, "down") end},
  {function() hs.eventtap.keyStroke({"shift", "alt", "cmd"}, "down") end},
})
default:conditionalBind({"shift", "ctrl", "cmd"}, "k", {
  {app = "Google Chrome", cond = isFloating, function() hs.eventtap.keyStroke({"ctrl", "cmd"}, "up") end},
  {app = "Google Chrome", function() hs.eventtap.keyStroke({"ctrl", "shift"}, "k") end},
  {app = "iTerm2", function() hs.eventtap.keyStroke({"ctrl", "cmd"}, "up") end},
  {cond = isFloating, function() hs.eventtap.keyStroke({"ctrl", "cmd"}, "up") end},
  {function() hs.eventtap.keyStroke({"shift", "alt", "cmd"}, "up") end},
})
default:conditionalBind({"shift", "ctrl", "cmd"}, "l", {
  {app = "Google Chrome", cond = isFloating, function() hs.eventtap.keyStroke({"ctrl", "cmd"}, "right") end},
  {app = "Google Chrome", function() hs.eventtap.keyStroke({"ctrl", "shift"}, "l") end},
  {app = "iTerm2", function() hs.eventtap.keyStroke({"ctrl", "cmd"}, "right") end},
  {cond = isFloating, function() hs.eventtap.keyStroke({"ctrl", "cmd"}, "right") end},
  {function() hs.eventtap.keyStroke({"shift", "alt", "cmd"}, "right") end},
})

-- Resize
default:bindOnce(hyper, "-", "Resize Smart -100", function() task({"wm-preset", "resize", "smart", "-100"}) end)
default:bindOnce(hyper, "=", "Resize Smart +100", function() task({"wm-preset", "resize", "smart", "+100"}) end)

-- Harpoon 1-9
for i = 1, 9 do
  default:bindOnce(hyper, tostring(i), "Harpoon Focus " .. i, function() fish("yabai-harpoon focus " .. i) end)
end
default:bindOnce(hyperShift, "=", "Harpoon Add", function() fish("yabai-harpoon add") end)

-- Window cycling
default:bindOnce(hyper, "n", "Focus Next Window", function() fish("wm-preset focus-window next; or wm-preset focus-floating-window next") end)
default:bindOnce(hyper, "p", "Focus Prev Window", function() fish("wm-preset focus-window prev; or wm-preset focus-floating-window prev") end)
default:bindOnce(hyperShift, "n", "Move Window In Stack Next", function() task({"wm-preset", "move-window-in-stack", "next"}) end)
default:bindOnce(hyperShift, "p", "Move Window In Stack Prev", function() task({"wm-preset", "move-window-in-stack", "prev"}) end)

-- Mode entries
default:bindOnce(hyper, "space", "Enter Service Mode", function() service:enter() end)
default:bindOnce(hyper, "i", "Enter Invoke Mode", function() invoke:enter() end)
default:bindOnce(hyper, "'", "Enter Chrome Mode", function() chrome:enter() end)

-- App shortcuts
default:bindOnce(hyper, "b", "Focus Hammerspoon Console", function() hs.toggleConsole() end)
default:bindOnce(hyper, "c", "Focus Cursor", function() task({"wm-preset", "focus-app", "Cursor"}) end)
default:conditionalBindOnce(hyper, "x", "Focus iTerm2", {
  {
    cond = isFloatingTerminal, a.sync(function ()
      a.wait(taskAsync({"wm-preset", "focus-app", "iTerm2"}))
      hs.eventtap.keyStroke({"cmd"}, "`")
    end)
  },
  { function () task({"wm-preset", "focus-app", "iTerm2"}) end }
})
default:bindOnce(hyper, "q", "Focus Gemini", function() task({"chrome-preset", "focus-or-open-url", "gemini.google.com", "--label", "Gemini"}) end)
default:bindOnce(hyper, "w", "Focus WhatsApp", function() task({"wm-preset", "focus-app", "WhatsApp"}) end)
default:bindOnce(hyper, "z", "Focus Obsidian", function() task({"wm-preset", "focus-app", "Obsidian"}) end)
default:bindOnce(hyper, "s", "Toggle YouTube Music", function() Preset.alternateApp("YouTube Music", {hide = true}) end)
default:bindOnce(hyper, "e", "Focus Chrome", function() task({"wm-preset", "focus-app", "Google Chrome"}) end)
default:bindOnce(hyper, "r", "Focus Chrome (alt)", function() task({"wm-preset", "focus-app", "Google Chrome"}) end)
default:bindOnce(hyper, "a", "Focus Timery", function() task({"wm-preset", "focus-app", "Timery"}) end)
default:bindOnce(hyperShift, "a", "Focus Pomofocus", function() task({"wm-preset", "focus-app", "Pomofocus"}) end)
default:bindOnce(hyperShift, "z", "Focus Google Keep", function() task({"wm-preset", "focus-app", "Google Keep"}) end)
default:conditionalBindOnce(hyperShift, "w", "Focus Zoom/Meet", {
  {cond = function() return isProcessRunning("zoom.us") end, function() task({"wm-preset", "focus-app", "zoom.us"}) end},
  {function() task({"chrome-preset", "focus-or-open-url", "meet.google.com", "--label", "Google Meet"}) end},
})
default:conditionalBindOnce(hyperShift, "s", "Toggle Mute Zoom/Meet", {
  {cond = function() return isProcessRunning("zoom.us") end, function()
    hs.alert.show("Toggle Mute")
    task({"wm-preset", "focus-app", "zoom.us"})
    hs.timer.doAfter(0.5, function() hs.eventtap.keyStroke({"cmd", "shift"}, "a") end)
  end},
  {function()
    hs.alert.show("Toggle Mute")
    task({"chrome-preset", "focus-or-open-url", "meet.google.com", "--label", "Google Meet"})
    hs.timer.doAfter(0.5, function() hs.eventtap.keyStroke({"cmd"}, "d") end)
  end},
})

default:bindOnce(hyperShift, "f", "Focus WhatsApp (shift)", function() task({"wm-preset", "focus-app", "WhatsApp"}) end)
default:bindOnce(hyperShift, "g", "Focus Messages", function() task({"wm-preset", "focus-app", "Messages"}) end)
default:bindOnce(hyperShift, "q", "Focus Activity Monitor", function() task({"wm-preset", "focus-app", "Activity Monitor"}) end)

default:bindOnce(hyper, "y", "Focus Calendar", function() task({"chrome-preset", "focus-or-open-url", "calendar.google.com", "--label", "Calendar"}) end)
default:bindOnce(hyper, "u", "Perform Default UI", function() task({"workflow-preset", "perform-default-ui"}) end)

-- Universal Actions (per-app)
default:conditionalBindOnce(hyper, "o", "Universal Actions", {
  {app = "iTerm2", function() fish("ua --clipboard") end},
  {function() fish("ua") end},
})
default:bindOnce(hyperShift, "o", "Universal Actions (force)", function() fish("ua") end)

-- kindaVim toggle
default:conditionalBindOnce(hyperShift, "v", "Toggle kindaVim", {
  {cond = function() return isProcessRunning("kindaVim") end, function()
    hs.alert.show("Exit kindaVim")
    task({"killall", "kindaVim"})
  end},
  {function()
    hs.alert.show("Enter kindaVim")
    task({"open", "-a", "kindaVim"})
  end},
})

-- Paste as plain text
default:bindOnce({"cmd", "alt"}, "v", "Paste as Plain Text", function()
  local text = hs.pasteboard.getContents()
  if text then hs.eventtap.keyStrokes(text) end
end)

-- Smart lock (screensaver on AC, lock on battery)
default:bindOnce({"ctrl", "cmd"}, "q", "Smart Lock", function()
  if hs.battery.powerSource() == "AC Power" then
    hs.caffeinate.startScreensaver()
  else
    hs.caffeinate.lockScreen()
  end
end)

---------------------------------------------------------------
-- App-specific modal helper
---------------------------------------------------------------

local function createAppModal(appName)
  local modal = hs.hotkey.modal.new()
  local watcher = hs.application.watcher.new(function(name, event)
    if event == hs.application.watcher.activated then
      if name == appName then modal:enter() else modal:exit() end
    end
  end)
  watcher:start()
  modal._appWatcher = watcher  -- prevent garbage collection
  if frontAppName() == appName then modal:enter() end
  return modal
end

---------------------------------------------------------------
-- Chrome app-specific hotkeys (only active when Chrome is focused)
---------------------------------------------------------------

local chromeAppModal = createAppModal("Google Chrome")

local sleepAsync = a.wrap(function(seconds, callback)
  hs.timer.doAfter(seconds, function() callback() end)
end)

chromeAppModal:bind({"ctrl", "shift"}, "d", function() Preset.triggerMenuBar("Tab;Move Tab to New Window") end)
chromeAppModal:bind({"ctrl", "alt"}, "d", function() Preset.triggerMenuBar("Tab;Duplicate Tab") end)
chromeAppModal:bind({"ctrl", "alt", "shift"}, "d", function()
  Preset.triggerMenuBar("Tab;Duplicate Tab")
  hs.timer.usleep(500000)
  Preset.triggerMenuBar("Tab;Move Tab to New Window")
end)
chromeAppModal:bind({"ctrl", "shift"}, "g", function() Preset.triggerMenuBar("Tab;Group Tab") end)
chromeAppModal:bind({"ctrl", "cmd"}, "1", function()
  hs.eventtap.keyStroke({"alt", "shift"}, "1")
  hs.eventtap.keyStroke({"ctrl", "shift"}, "1")
end)

local cmdTHk = chromeAppModal:bind({"cmd"}, "t", function()
  if isFloatingTerminal() then
    cmdTHk:disable()
    hs.eventtap.keyStroke({"cmd"}, "t")
    cmdTHk:enable()
  else
    Preset.triggerMenuBar("Tab;New Tab to the Right")
  end
end)

---------------------------------------------------------------
-- SERVICE MODE bindings
---------------------------------------------------------------

-- Neovide paste in service
service:bindOnce(hyper, "v", "Neovide Paste", function()
  hs.eventtap.keyStroke({"cmd"}, "c")
  hs.timer.doAfter(0.1, function() fish("pbneovide --guess") end)
end)

-- Harpoon
service:bindOnce({}, "a", "Harpoon Add", function() fish("yabai-harpoon add") end)
service:bindOnce({}, "delete", "Harpoon Delete", function() fish("yabai-harpoon delete") end)
service:bindOnce({}, "e", "Harpoon Edit", function() fish("yabai-harpoon edit") end)

-- Side-by-side
service:bindOnce({"shift"}, ";", "Side By Side", function() task({"yabai-preset", "side-by-side"}) end)

-- Edit hammerspoon keybindings
service:bindOnce(hyper, "e", "Edit Keybindings", function()
  hs.alert.show("Edit Keybindings")
  fish('neovim-ghost focus-or-new-tab "$HOME/.hammerspoon/keybindings.lua"')
end)

-- Space focus
service:bindOnce(hyper, "space", "Focus Space Recent", function() task({"wm-preset", "focus-space", "recent"}) end)
service:bindOnce({}, "space", "Focus Back And Forth", function() task({"wm-preset", "focus-back-and-forth"}) end)
service:bindOnce({"shift"}, "space", "Move Window To Space Recent", function() task({"wm-preset", "move-window-to-space", "recent"}) end)

-- Mode transitions
service:bindOnce({}, "r", "Enter Resize Mode", function() resize:enter() end)
service:bindOnce(hyper, "r", "Enter Restart Mode", function() restart:enter() end)

-- Window management
service:bindOnce({"shift"}, "y", "Toggle WM", function() task({"wm-preset", "toggle-wm"}) end)
service:bindOnce({}, "v", "Insert Direction East", function() task({"wm-preset", "insert-direction", "east"}) end)
service:bindOnce({"shift"}, "'", "Insert Direction South", function() task({"wm-preset", "insert-direction", "south"}) end)
service:bindOnce({}, "t", "Toggle Float", function() fish('display-message (wm-preset toggle-float)') end)
service:bindOnce({}, "z", "Insert Direction Stack", function() task({"wm-preset", "insert-direction", "stack"}) end)
service:bindOnce({}, "s", "Insert Direction Stack (s)", function() task({"wm-preset", "insert-direction", "stack"}) end)
service:bindOnce({"shift"}, "s", "Stack Windows In Space", function() task({"wm-preset", "stack-windows-in-space"}) end)
service:bindOnce({}, "m", "Minimize After 3rd", function() task({"wm-preset", "minimize-after-nth-window", "3"}) end)
service:bindOnce({"shift"}, "m", "Deminimize All", function() task({"wm-preset", "deminimize-all"}) end)
service:bindOnce({}, ",", "Layout Stack", function() task({"wm-preset", "layout-stack"}) end)
service:bindOnce({"shift"}, ",", "Layout BSP + Stack", function() fish("wm-preset layout-bsp; wm-preset stack-windows-in-space") end)
service:bindOnce({"shift"}, ".", "Layout BSP + Minimize", function() fish("wm-preset layout-bsp; wm-preset minimize-after-nth-window 3") end)
service:bindOnce({"shift"}, "t", "Layout Float", function() task({"wm-preset", "layout-float"}) end)
service:bindOnce({}, ".", "Layout BSP", function() task({"wm-preset", "layout-bsp"}) end)
service:bindOnce({}, "0", "Flatten", function() task({"wm-preset", "flatten"}) end)

-- Mirror / split / balance
service:bindOnce({"shift"}, "\\", "Mirror Y-Axis", function() task({"wm-preset", "mirror", "y-axis"}) end)
service:bindOnce({}, "-", "Mirror X-Axis", function() task({"wm-preset", "mirror", "x-axis"}) end)
service:bindOnce({}, "y", "Toggle Split", function() task({"wm-preset", "toggle-split"}) end)
service:bindOnce({}, "=", "Balance", function() task({"wm-preset", "balance"}) end)

-- Focus space 1-9
for i = 1, 9 do
  service:bindOnce({}, tostring(i), "Focus Space " .. i, function() task({"wm-preset", "focus-space", tostring(i)}) end)
end

-- Move window to space 1-9
for i = 1, 9 do
  service:bindOnce({"shift"}, tostring(i), "Move Window To Space " .. i, function() task({"wm-preset", "move-window-to-space", tostring(i)}) end)
end

-- Warp window HJKL
service:bindOnce(hyper, "h", "Warp Window West", function() task({"wm-preset", "warp-window", "west"}) end)
service:bindOnce(hyper, "j", "Warp Window South", function() task({"wm-preset", "warp-window", "south"}) end)
service:bindOnce(hyper, "k", "Warp Window North", function() task({"wm-preset", "warp-window", "north"}) end)
service:bindOnce(hyper, "l", "Warp Window East", function() task({"wm-preset", "warp-window", "east"}) end)

-- Focus display HJKL
service:bindOnce({}, "h", "Focus Display West", function() task({"wm-preset", "focus-display-with-fallback", "west"}) end)
service:bindOnce({}, "j", "Focus Display South", function() task({"wm-preset", "focus-display-with-fallback", "south"}) end)
service:bindOnce({}, "k", "Focus Display North", function() task({"wm-preset", "focus-display-with-fallback", "north"}) end)
service:bindOnce({}, "l", "Focus Display East", function() task({"wm-preset", "focus-display-with-fallback", "east"}) end)

-- Misc service
service:bindOnce({}, "tab", "Move Window To Next Display", function() task({"wm-preset", "smart-move-window-to-next-display"}) end)
service:bindOnce(hyperShift, "tab", "Swap Workspaces Between Monitors", function() task({"wm-preset", "swap-workspaces-between-monitors"}) end)
service:bindOnce({"shift"}, "/", "Trigger Help Menu", function() Preset.triggerMenuBar("Help") end)
service:bindOnce(hyper, "/", "Search Mappings", showCommandPalette)
service:bindOnce({"shift"}, "v", "Tile Left", function() Preset.triggerMenuBar("Window;Full Screen Tile; Left of Screen") end)
service:bindOnce(hyper, "return", "True Fullscreen", function() hs.eventtap.keyStroke({"ctrl", "cmd"}, "f") end)

-- Enter chrome from service
service:bindOnce({}, "c", "Enter Chrome Mode", function() chrome:enter() end)

---------------------------------------------------------------
-- RESIZE MODE bindings (stays in mode, no exit on key press)
---------------------------------------------------------------

resize:bind({}, "return", function() resize:exit() end)
resize:bind({}, "j", function() task({"wm-preset", "resize", "height", "+100"}) end)
resize:bind({}, "k", function() task({"wm-preset", "resize", "height", "-100"}) end)
resize:bind({}, "h", function() task({"wm-preset", "resize", "width", "-100"}) end)
resize:bind({}, "l", function() task({"wm-preset", "resize", "width", "+100"}) end)
resize:bind({"shift"}, "j", function() task({"wm-preset", "resize", "height", "+100"}) end)
resize:bind({"shift"}, "k", function() task({"wm-preset", "resize", "height", "-100"}) end)
resize:bind({"shift"}, "h", function() task({"wm-preset", "resize", "width", "-100"}) end)
resize:bind({"shift"}, "l", function() task({"wm-preset", "resize", "width", "+100"}) end)
resize:bind({"shift"}, ",", function() task({"wm-preset", "rotate", "90"}) end)
resize:bind({"shift"}, ".", function() task({"wm-preset", "rotate", "270"}) end)

---------------------------------------------------------------
-- RESTART MODE bindings
---------------------------------------------------------------

restart:bindOnce(hyper, "y", "Restart WM", function() task({"yabai-preset", "restart-wm"}) end)
restart:bindOnce(hyperShift, "b", "Restart Hammerspoon", function() hs.alert.show("Restarting Hammerspoon"); hs.relaunch() end)
restart:bindOnce(hyper, "a", "Restart Alfred", function() hs.alert.show("Restart Alfred"); fish('killall Alfred; sleep 2; and open -a "Alfred 5"') end)
restart:bindOnce(hyper, "m", "Restart Mouseless", function() hs.alert.show("Restart Mouseless"); fish('killall mouseless; sleep 2; and open -a "Mouseless"') end)
restart:bindOnce(hyper, "v", "Restart NVIM Ghost", function() hs.alert.show("Restart NVIM Ghost"); fish("neovim-ghost kill; sleep 2; and neovim-ghost start") end)
restart:bindOnce(hyper, "k", "Restart Karabiner", function() hs.alert.show("Restart Karabiner"); fish('launchctl kickstart -k gui/(id -u)/org.pqrs.service.agent.karabiner_console_user_server') end)
restart:bindOnce(hyper, "h", "Restart Hammerspoon", function() hs.alert.show("Restarting Hammerspoon"); hs.reload() end)
restart:conditionalBindOnce(hyper, "s", "Toggle AeroSpace", {
  {cond = function() return isProcessRunning("AeroSpace") end, function()
    hs.alert.show("Killing AeroSpace")
    task({"killall", "AeroSpace"})
  end},
  {function()
    task({"yabai-preset", "layout-float-all"})
    hs.alert.show("Starting AeroSpace")
    task({"open", "-a", "AeroSpace"})
  end},
})

---------------------------------------------------------------
-- CHROME MODE bindings
---------------------------------------------------------------

-- Mode transitions
chrome:bindOnce(hyper, "'", "Enter Go To Mode", function() goto_mode:enter() end)
chrome:bind({}, "'", function() chrome:exit(); goto_mode:enter() end)

-- Close zoom tabs
chrome:bindOnce({}, "delete", "Close Zoom Tabs", function() task({"chrome-preset", "close-tabs-with-url", [[^.*\.zoom\.us/j/.*$]]}) end)

-- Focus pinned tab 1-9
for i = 1, 9 do
  chrome:bindOnce({}, tostring(i), "Focus Pinned Tab " .. i, function() task({"chrome-preset", "focus-pinned-tab", tostring(i)}) end)
end

-- Pin tab 1-9
for i = 1, 9 do
  chrome:bindOnce({"shift"}, tostring(i), "Pin Tab " .. i, function() task({"chrome-preset", "pin-tab", tostring(i)}) end)
end

-- Chrome URL shortcuts
chrome:bindOnce({}, "y", "YouTube", function() task({"chrome-preset", "focus-or-open-url", "--profile=Default", "youtube.com"}) end)
chrome:bindOnce({}, "g", "Gmail", function() task({"chrome-preset", "focus-or-open-url", "--profile=Default", "gmail.com"}) end)

---------------------------------------------------------------
-- GOTO MODE bindings
---------------------------------------------------------------

goto_mode:bindOnce({}, "y", "YouTube (new tab)", function() task({"chrome-preset", "open-url", "--profile=Default", "youtube.com"}) end)
goto_mode:bindOnce({}, "g", "Gmail (new tab)", function() task({"chrome-preset", "open-url", "--profile=Default", "gmail.com"}) end)

---------------------------------------------------------------
-- INVOKE MODE bindings
---------------------------------------------------------------

invoke:bindOnce({}, "1", "Arrange Work Spaces", function()
  task({"wm-preset", "arrange-spaces", "-w", [[1:.*Thales \(Work\).*]], "-a", "2:iTerm2", "-a", [[3:.*VS Code.*]], "-a", "4:Workchat", "-a", "5:Obsidian"})
end)
invoke:bindOnce({}, "p", "Arrange Personal Spaces", function()
  task({"wm-preset", "arrange-spaces", "-w", [[7:.*Thales \(Personal\).*]]})
end)
invoke:bindOnce({}, "b", "Alfred BTT Search", function() hs.applescript([[tell application "Alfred" to search "btt "]]) end)
invoke:bindOnce({}, "t", "Alfred Top Search", function() hs.applescript([[tell application "Alfred" to search "top "]]) end)
invoke:bindOnce({}, "y", "YouTube Search", function() task({"open", "raycast://extensions/tonka3000/youtube/search-videos?arguments=%7B%22query%22%3A%22%22%7D"}) end)
invoke:bindOnce({}, "return", "New iTerm Window", function() task({"iterm-preset", "new-window"}) end)
invoke:bindOnce(hyper, "i", "AI Input Mode", function() hs.alert.show("AI Input Mode"); fish('osascript -e "set volume input volume 100"; set-preferred-input-device') end)
invoke:bindOnce(hyper, "r", "Reinitialize Displays", function() hs.alert.show("Reinitialize Displays"); fish("betterdisplaycli perform --reinitialize") end)

---------------------------------------------------------------
-- Apply local overrides
---------------------------------------------------------------

local ctx = {
  fish = fish,
  fishAsync = fishAsync,
  task = task,
  taskAsync = taskAsync,
  frontAppName = frontAppName,
  default = default,
  service = service,
  chrome = chrome,
  goto_mode = goto_mode,
  invoke = invoke,
  resize = resize,
  restart = restart,
  hyper = hyper,
  hyperShift = hyperShift,
  registerBinding = registerBinding,
  Mode = Mode,
  isFloatingTerminal = isFloatingTerminal,
  chromeAppModal = chromeAppModal,
}

if ok and localConfig and localConfig.setup then
  localConfig.setup(ctx)
end

---------------------------------------------------------------
-- Module return
---------------------------------------------------------------

return {
  default = default,
  service = service,
  chrome = chrome,
  goto_mode = goto_mode,
  invoke = invoke,
  resize = resize,
  restart = restart,
  hyper = hyper,
  hyperShift = hyperShift,
  fish = fish,
  task = task,
  showCommandPalette = showCommandPalette,
  Mode = Mode,
}
