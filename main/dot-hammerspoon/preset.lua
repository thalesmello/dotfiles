local a = require("async")

local M = {}

-- Prevent hs.task objects from being garbage-collected before their callback fires
local _runningTasks = {}

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

function M.triggerMenuBar(path)
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

M.triggerMenuBarAsync = a.wrap(function(path, callback)
  local app = hs.application.frontmostApplication()
  if not app then callback(false); return end

  local items = {}
  for item in path:gmatch("[^;]+") do
    items[#items + 1] = item:match("^%s*(.-)%s*$")
  end
  if #items == 0 then callback(false); return end

  local script = buildMenuBarScript(app:name(), items)
  local task
  task = hs.task.new("/usr/bin/osascript", function(exitCode)
    _runningTasks[task] = nil
    callback(exitCode == 0)
  end, {"-e", script})
  _runningTasks[task] = true
  task:start()
end)

function M.getActiveApp()
  local app = hs.application.frontmostApplication()
  return app and app:name() or ""
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

---------------------------------------------------------------
-- Window management helpers (replaces yabai-preset calls)
---------------------------------------------------------------

function M.getFocusedWindowId()
  local win = hs.window.focusedWindow()
  return win and tostring(win:id()) or ""
end

function M.focusWindowById(id)
  local win = hs.window.get(tonumber(id))
  if win then
    win:focus()
    return true
  end
  return false
end

function M.windowExists(id)
  return hs.window.get(tonumber(id)) ~= nil
end

function M.minimizeWindow(id)
  local win
  if id then
    win = hs.window.get(tonumber(id))
  else
    win = hs.window.focusedWindow()
  end
  if win then
    win:minimize()
    return true
  end
  return false
end

function M.deminimizeLast()
  for _, app in ipairs(hs.application.runningApplications()) do
    for _, win in ipairs(app:allWindows()) do
      if win:isMinimized() then
        win:unminimize()
        win:focus()
        return tostring(win:id())
      end
    end
  end
  return ""
end

function M.deminimizeAll()
  local count = 0
  for _, app in ipairs(hs.application.runningApplications()) do
    for _, win in ipairs(app:allWindows()) do
      if win:isMinimized() then
        win:unminimize()
        count = count + 1
      end
    end
  end
  return count
end

-- Focus history tracker — keeps window objects in most-recently-focused order
local _focusHistory = {}     -- list of {id=number, win=hs.window}
local _focusHistoryMax = 50

local function _trackFocus(win)
  if not win then return end
  local id = win:id()
  if not id then return end
  if not win:isStandard() then return end
  for i = #_focusHistory, 1, -1 do
    if _focusHistory[i].id == id then table.remove(_focusHistory, i); break end
  end
  table.insert(_focusHistory, 1, {id = id, win = win})
  if #_focusHistory > _focusHistoryMax then
    table.remove(_focusHistory)
  end
end

M._trackFocus = _trackFocus

-- Seed with current focused window
do
  local win = hs.window.focusedWindow()
  if win then _trackFocus(win) end
end

-- Track cross-app focus changes
local _appWatcher = hs.application.watcher.new(function(name, event, app)
  if event == hs.application.watcher.activated then
    local win = hs.window.focusedWindow()
    if win then _trackFocus(win) end
  end
end)
_appWatcher:start()

-- Track same-app window switches (e.g. Chrome profile changes, cmd+backtick)
-- _trackFocus already filters out non-standard windows (like Wispr Flow overlays)
hs.window.filter.default:subscribe(hs.window.filter.windowFocused, _trackFocus)

function M.getRecentWindowId()
  local focused = hs.window.focusedWindow()
  local focusedId = focused and focused:id()
  for _, entry in ipairs(_focusHistory) do
    if entry.id ~= focusedId then
      if entry.win and entry.win:id() and not entry.win:isMinimized() then
        return tostring(entry.id)
      end
    end
  end
  return ""
end

-- Focus the most recent non-focused standard window using macOS z-order
function M.focusRecentWindow()
  local focused = hs.window.focusedWindow()
  local focusedId = focused and focused:id()
  for _, win in ipairs(hs.window.orderedWindows()) do
    if win:id() ~= focusedId and not win:isMinimized() and win:isStandard() then
      win:focus()
      return true
    end
  end
  return false
end

function M.getAppWindowId(appName, titlePattern)
  local app = hs.application.get(appName)
  if not app then return "" end

  local wins = app:allWindows()
  if #wins == 0 then return "" end

  if titlePattern and #titlePattern > 0 then
    local filtered = {}
    for _, win in ipairs(wins) do
      if win:title():find(titlePattern) then
        table.insert(filtered, win)
      end
    end
    wins = filtered
    if #wins == 0 then return "" end
  end

  local focusedWin = hs.window.focusedWindow()
  local focusedScreen = focusedWin and focusedWin:screen()

  table.sort(wins, function(a, b)
    local aMin = a:isMinimized() and 1 or 0
    local bMin = b:isMinimized() and 1 or 0
    if aMin ~= bMin then return aMin < bMin end
    if focusedScreen then
      local aScreen = (a:screen() == focusedScreen) and 0 or 1
      local bScreen = (b:screen() == focusedScreen) and 0 or 1
      if aScreen ~= bScreen then return aScreen < bScreen end
    end
    return false
  end)

  return tostring(wins[1]:id())
end

function M.focusPid(pid)
  pid = tonumber(pid)
  local app = hs.application.applicationForPID(pid)
  if app then
    local win = app:focusedWindow() or app:allWindows()[1]
    if win then
      win:focus()
      return true
    end
  end
  return false
end

function M.minimizePid(pid)
  pid = tonumber(pid)
  local app = hs.application.applicationForPID(pid)
  if app then
    local win = app:focusedWindow() or app:allWindows()[1]
    if win then
      win:minimize()
      return true
    end
  end
  return false
end

function M.focusFloatingWindow(idsJson, focusedId, direction)
  local ids = hs.json.decode(idsJson)
  focusedId = tonumber(focusedId)

  local windows = {}
  for _, id in ipairs(ids) do
    local win = hs.window.get(id)
    if win then
      local f = win:frame()
      table.insert(windows, {id = id, x = f.x, y = f.y, w = f.w, h = f.h})
    end
  end

  if #windows == 0 then return "" end

  if direction == "next" or direction == "prev" or direction == "first" or direction == "last" then
    table.sort(windows, function(a, b)
      if a.x ~= b.x then return a.x < b.x end
      if a.y ~= b.y then return a.y < b.y end
      return a.id < b.id
    end)

    local pos = nil
    for i, w in ipairs(windows) do
      if w.id == focusedId then pos = i; break end
    end

    if pos == nil then return tostring(windows[1].id) end

    local target
    if direction == "first" then target = 1
    elseif direction == "last" then target = #windows
    elseif direction == "prev" then target = pos - 1
    elseif direction == "next" then target = pos + 1
    end

    if target < 1 or target > #windows then return "" end
    return tostring(windows[target].id)

  else -- east/west/north/south
    local cur = nil
    for _, w in ipairs(windows) do
      if w.id == focusedId then cur = w; break end
    end
    if not cur then cur = windows[1] end

    local candidates = {}
    for _, w in ipairs(windows) do
      if w.id ~= focusedId then
        local match = false
        if direction == "east" then match = w.x >= (cur.x + cur.w / 2)
        elseif direction == "west" then match = (w.x + w.w) <= (cur.x + cur.w / 2)
        elseif direction == "south" then match = w.y >= (cur.y + cur.h / 2)
        elseif direction == "north" then match = (w.y + w.h) <= (cur.y + cur.h / 2)
        end
        if match then
          local dx = (w.x + w.w/2) - (cur.x + cur.w/2)
          local dy = (w.y + w.h/2) - (cur.y + cur.h/2)
          w.dist = dx*dx + dy*dy
          table.insert(candidates, w)
        end
      end
    end

    if #candidates == 0 then return "" end
    table.sort(candidates, function(a, b) return a.dist < b.dist end)
    return tostring(candidates[1].id)
  end
end

function M.snapWindow(direction)
  local win = hs.window.focusedWindow()
  if not win then return end

  local f = win:frame()
  local max = win:screen():frame()

  local function onSide()
    if direction == "west" then return math.abs(f.x - max.x) < (max.w * 0.05)
    elseif direction == "east" then return math.abs((f.x + f.w) - (max.x + max.w)) < (max.w * 0.05)
    elseif direction == "north" then return math.abs(f.y - max.y) < (max.h * 0.05)
    elseif direction == "south" then return math.abs((f.y + f.h) - (max.y + max.h)) < (max.h * 0.05)
    end
    return false
  end

  local grid = "half"
  if onSide() then
    if direction == "west" or direction == "east" then
      local ratio = f.w / max.w
      if math.abs(ratio - 0.5) < 0.05 then grid = "two_thirds"
      elseif math.abs(ratio - 0.6667) < 0.05 then grid = "one_third"
      end
    else
      local ratio = f.h / max.h
      if math.abs(ratio - 0.5) < 0.05 then grid = "two_thirds"
      elseif math.abs(ratio - 0.6667) < 0.05 then grid = "one_third"
      end
    end
  end

  local grids = {
    west  = {half = {0,0,0.5,1}, two_thirds = {0,0,2/3,1}, one_third = {0,0,1/3,1}},
    east  = {half = {0.5,0,0.5,1}, two_thirds = {1/3,0,2/3,1}, one_third = {2/3,0,1/3,1}},
    north = {half = {0,0,1,0.5}, two_thirds = {0,0,1,2/3}, one_third = {0,0,1,1/3}},
    south = {half = {0,0.5,1,0.5}, two_thirds = {0,1/3,1,2/3}, one_third = {0,2/3,1,1/3}},
  }

  local g = grids[direction] and grids[direction][grid]
  if g then
    f.x = math.floor(max.x + max.w * g[1])
    f.y = math.floor(max.y + max.h * g[2])
    f.w = math.floor(max.w * g[3])
    f.h = math.floor(max.h * g[4])
    win:setFrame(f)
  end
end

function M.sideBySide()
  local focused = hs.window.focusedWindow()
  if not focused then return end

  local screen = focused:screen():frame()

  local recent = nil
  for _, win in ipairs(hs.window.orderedWindows()) do
    if win:id() ~= focused:id() and not win:isMinimized() then
      recent = win
      break
    end
  end

  focused:setFrame({
    x = screen.x, y = screen.y,
    w = math.floor(screen.w / 2), h = screen.h
  })

  if recent then
    recent:setFrame({
      x = screen.x + math.floor(screen.w / 2), y = screen.y,
      w = math.floor(screen.w / 2), h = screen.h
    })
    focused:focus()
  end
end

function M.getFocusedWindowJson()
  local win = hs.window.focusedWindow()
  if not win then return "{}" end
  local app = win:application()
  return hs.json.encode({
    id = win:id(),
    app = app and app:name() or "",
    title = win:title(),
    ["has-focus"] = true,
  })
end

function M.getAllWindowsJson()
  local result = {}
  for _, win in ipairs(hs.window.allWindows()) do
    local app = win:application()
    table.insert(result, {
      id = win:id(),
      app = app and app:name() or "",
      title = win:title(),
    })
  end
  return hs.json.encode(result)
end

function M.getAppWindowIds(appName)
  local app = hs.application.get(appName)
  if not app then return "" end
  local ids = {}
  for _, win in ipairs(app:allWindows()) do
    ids[#ids + 1] = tostring(win:id())
  end
  return table.concat(ids, ",")
end

function M.findNewWindow(appName, oldIdsStr)
  local oldSet = {}
  if oldIdsStr and #oldIdsStr > 0 then
    for id in oldIdsStr:gmatch("[^,]+") do
      oldSet[tonumber(id)] = true
    end
  end
  local app = hs.application.get(appName)
  if not app then return "" end
  for _, win in ipairs(app:allWindows()) do
    if not oldSet[win:id()] then
      return tostring(win:id())
    end
  end
  return ""
end

-- One-shot watcher state (prevent GC)
local _pendingWatchers = {}

function M.watchNewWindow(appName, callbackCmd)
  local wf = hs.window.filter.new(appName)
  local timeout

  local function cleanup()
    if timeout then timeout:stop(); timeout = nil end
    wf:unsubscribe(hs.window.filter.windowCreated)
    _pendingWatchers[wf] = nil
    wf = nil
  end

  wf:subscribe(hs.window.filter.windowCreated, function(win)
    if not win then return end
    cleanup()
    local task
    task = hs.task.new("/opt/homebrew/bin/fish", function()
      _runningTasks[task] = nil
    end, {"-c", callbackCmd:gsub("%%WINDOW_ID%%", tostring(win:id()))})
    _runningTasks[task] = true
    task:start()
  end)

  -- Timeout after 15 seconds
  timeout = hs.timer.doAfter(15, function()
    cleanup()
  end)

  _pendingWatchers[wf] = true
end

local _savedFrames = {}

function M.toggleFloatingFullscreen()
  local win = hs.window.focusedWindow()
  if not win then return end

  local id = win:id()
  local f = win:frame()
  local max = win:screen():frame()

  -- Check if window is already ~fullscreen (covers >=90% of screen)
  local isFullscreen = math.abs(f.w - max.w) < (max.w * 0.1)
      and math.abs(f.h - max.h) < (max.h * 0.1)

  if isFullscreen and _savedFrames[id] then
    win:setFrame(_savedFrames[id])
    _savedFrames[id] = nil
  else
    _savedFrames[id] = {x = f.x, y = f.y, w = f.w, h = f.h}
    win:setFrame(max)
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

return M
