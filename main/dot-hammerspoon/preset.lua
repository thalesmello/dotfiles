local a = require("async")

local M = {}

-- Prevent hs.task objects from being garbage-collected before their callback fires
_G._runningTasks = {}

local keyMap = {
  ctrl = "ctrl", shift = "shift", alt = "alt", cmd = "cmd",
  a = "a", b = "b", c = "c", d = "d", e = "e", f = "f",
  g = "g", h = "h", i = "i", j = "j", k = "k", l = "l",
  m = "m", n = "n", o = "o", p = "p", q = "q", r = "r",
  s = "s", t = "t", u = "u", v = "v", w = "w", x = "x",
  y = "y", z = "z", space = "space", ["return"] = "return",
  left = "left", right = "right", up = "up", down = "down",
  fn = "fn", tab = "tab", escape = "escape", backtick = "`",
  backslash = "\\", delete = "delete",
  ["1"] = "1", ["2"] = "2", ["3"] = "3", ["4"] = "4", ["5"] = "5",
  ["6"] = "6", ["7"] = "7", ["8"] = "8", ["9"] = "9", ["0"] = "0",
}

local modifiers = { ctrl = true, shift = true, alt = true, cmd = true, fn = true }

function M.sendKeys(args)
  local mods = {}
  local key = nil
  for _, arg in ipairs(args) do
    if modifiers[arg] then
      table.insert(mods, arg)
    else
      key = keyMap[arg] or arg
    end
  end
  if key then
    hs.eventtap.keyStroke(mods, key)
  end
end

function M.displayMessage(message, duration)
  hs.alert.show(message, duration or 0.5)
end

-- Helper: build AppleScript to click a menu path
local function buildMenuBarScript(processName, items)
  local function esc(s) return s:gsub('"', '\\"') end

  if #items == 1 then
    return string.format(
      'tell application "System Events" to tell process "%s" to click menu bar item "%s" of menu bar 1',
      esc(processName), esc(items[1]))
  end

  -- Build: menu item "last" of menu 1 of menu item "..." of menu 1 of menu bar item "first" of menu bar 1
  local chain = string.format('menu item "%s"', esc(items[#items]))
  for i = #items - 1, 2, -1 do
    chain = chain .. string.format(' of menu 1 of menu item "%s"', esc(items[i]))
  end
  chain = chain .. string.format(' of menu 1 of menu bar item "%s" of menu bar 1', esc(items[1]))

  return string.format(
    'tell application "System Events" to tell process "%s" to click %s',
    esc(processName), chain)
end

function M.triggerMenuBarSync(path)
  local app = hs.application.frontmostApplication()
  if not app then return false end

  local items = {}
  for item in path:gmatch("[^;]+") do
    items[#items + 1] = item:match("^%s*(.-)%s*$")
  end
  if #items == 0 then return false end

  local script = buildMenuBarScript(app:name(), items)
  local ok = hs.applescript(script)
  return ok
end

M.triggerMenuBar = function(path, callback)
  local app = hs.application.frontmostApplication()
  if not app then if callback then callback(false) end; return end

  local items = {}
  for item in path:gmatch("[^;]+") do
    items[#items + 1] = item:match("^%s*(.-)%s*$")
  end
  if #items == 0 then if callback then callback(false) end; return end

  local script = buildMenuBarScript(app:name(), items)
  local task
  task = hs.task.new("/usr/bin/osascript", function(exitCode)
    _runningTasks[task] = nil
    if callback then callback(exitCode == 0) end
  end, {"-e", script})
  _runningTasks[task] = true
  task:start()
end

M.triggerMenuBarAsync = a.wrap(M.triggerMenuBar)

function M.getActiveApp()
  local app = hs.application.frontmostApplication()
  return app and app:name() or ""
end

function M.getSelectedText()
  local elem = hs.axuielement.systemWideElement()
  local focused = elem:attributeValue("AXFocusedUIElement")
  if focused then
    return focused:attributeValue("AXSelectedText") or ""
  end
  return ""
end

function M.showOrHideApp(appName, onlyShow, onlyHide)
  local app = hs.application.get(appName)
  if onlyShow then
    if app then app:activate() else hs.application.open(appName) end
  elseif onlyHide then
    if app then app:hide() end
  else
    if app and app:isFrontmost() then app:hide()
    elseif app then app:activate()
    else hs.application.open(appName) end
  end
end

function M.alternateApp(appName, opts)
  opts = opts or {}
  local front = hs.application.frontmostApplication()
  if front and front:name() == appName then
    if opts.hide then
      front:hide()
    elseif opts.minimize then
      local win = front:focusedWindow()
      if win then win:minimize() end
    end
  else
    if opts.cmd then
      local task
      task = hs.task.new("/opt/homebrew/bin/fish", function()
        _runningTasks[task] = nil
      end, {"-c", opts.cmd})
      _runningTasks[task] = true
      task:start()
    else
      hs.application.open(appName)
    end
  end
end

local _savedFrames = {}

function M.hasSavedFloatingFrame()
  local win = hs.window.focusedWindow()
  if not win then return false end
  return _savedFrames[win:id()] ~= nil
end

function M.toggleFloatingFullscreen()
  local win = hs.window.focusedWindow()
  if not win then return end

  local id = win:id()
  local f = win:frame()
  local max = win:screen():frame()

  if _savedFrames[id] then
    win:setFrame(_savedFrames[id], 0)
    _savedFrames[id] = nil
  else
    _savedFrames[id] = {x = f.x, y = f.y, w = f.w, h = f.h}
    win:setFrame(max, 0)
  end
end

function M.hideCursor()
  local screen = hs.screen.mainScreen():fullFrame()
  hs.mouse.absolutePosition({x = screen.w + 100, y = screen.h + 100})
end

function M.shareScreenWithIPad()
  hs.osascript.applescript([[
    tell application "System Events"
      tell process "Control Center"
        click menu bar item "Screen Mirroring" of menu bar 1
      end tell
    end tell
  ]])
end

function M.gotoSpace(spaceIndex)
  local allSpaces = {}
  for _, screen in ipairs(hs.screen.allScreens()) do
    local spaces = hs.spaces.spacesForScreen(screen)
    if spaces then
      for _, sid in ipairs(spaces) do
        if hs.spaces.spaceType(sid) == "user" then
          allSpaces[#allSpaces + 1] = sid
        end
      end
    end
  end
  if spaceIndex < 1 or spaceIndex > #allSpaces then return false end
  hs.spaces.gotoSpace(allSpaces[spaceIndex])
  return true
end

function M.moveWindowToSpace(spaceIndex)
  local win = hs.window.focusedWindow()
  if not win then return false end

  local frame = win:frame()
  local titleBarPoint = {x = frame.x + frame.w / 2, y = frame.y + 3}
  local originalPos = hs.mouse.absolutePosition()

  hs.mouse.absolutePosition(titleBarPoint)

  local steps = {
    { delay = 0.05, fn = function()
      hs.eventtap.event.newMouseEvent(
        hs.eventtap.event.types.leftMouseDown, titleBarPoint):post()
    end },
    { delay = 0.15, fn = function()
      hs.eventtap.keyStroke({"ctrl"}, tostring(spaceIndex))
    end },
    { delay = 0.4, fn = function()
      hs.eventtap.event.newMouseEvent(
        hs.eventtap.event.types.leftMouseUp, hs.mouse.absolutePosition()):post()
    end },
    { delay = 0.01, fn = function()
      hs.mouse.absolutePosition(originalPos)
    end },
  }

  local function runStep(i)
    if i > #steps then return end
    hs.timer.doAfter(steps[i].delay, function()
      steps[i].fn()
      runStep(i + 1)
    end)
  end
  runStep(1)
  return true
end

function M.moveWindowToNextScreen()
  local win = hs.window.focusedWindow()
  if not win then return false end
  local currentScreen = win:screen()
  local nextScreen = currentScreen:next()
  if not nextScreen or nextScreen == currentScreen then return false end
  win:moveToScreen(nextScreen, false, true, 0)
  return true
end

return M
