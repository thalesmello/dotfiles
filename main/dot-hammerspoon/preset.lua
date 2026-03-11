local M = {}

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

function M.triggerMenuBar(path)
  local app = hs.application.frontmostApplication()
  local items = {}
  for item in path:gmatch("[^;]+") do
    items[#items + 1] = item:match("^%s*(.-)%s*$")
  end
  app:selectMenuItem(items)
end

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
      hs.task.new("/opt/homebrew/bin/fish", nil, {"-c", opts.cmd}):start()
    else
      hs.application.open(appName)
    end
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
