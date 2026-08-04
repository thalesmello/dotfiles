local a = require("async")
local shell = require("shell")

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

-- Legacy send-keys, kept for reference: relies on hs.eventtap.keyStroke, which
-- can merge physically-held modifiers (e.g. the hyper chord that triggered the
-- binding) into the synthesized event. Superseded by M.sendKeys below, which
-- sets the flags absolutely. Retained under a new name so the old approach
-- isn't lost.
function M.sendKeysLegacy(args)
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

-- Numeric keycodes, mirroring `osascript-preset get-key-codes` so every key the
-- presets synthesize resolves identically. Using explicit keycodes (rather than
-- hs.keycodes.map name lookups) keeps names like "leftbracket"/"f17" working.
local sendKeyCodes = {
  ctrl = 59, shift = 56, alt = 58, cmd = 55,
  a = 0, b = 11, c = 8, d = 2, e = 14, f = 3,
  g = 5, h = 4, i = 34, j = 38, k = 40, l = 37,
  m = 46, n = 45, o = 31, p = 35, q = 12, r = 15,
  s = 1, t = 17, u = 32, v = 9, w = 13, x = 7,
  y = 16, z = 6, space = 49, ["return"] = 36, left = 123,
  right = 124, up = 126, down = 125, fn = 63, ["1"] = 18,
  ["2"] = 19, ["3"] = 20, ["4"] = 21, ["5"] = 23, ["6"] = 22, ["7"] = 26,
  ["8"] = 28, ["9"] = 25, ["0"] = 29, tab = 48, escape = 53,
  backspace = 51, delete = 51,
  backtick = 50, backslash = 42, slash = 44, minus = 27,
  semicolon = 41,
  leftbracket = 33, rightbracket = 30,
  f1 = 122, f2 = 120, f3 = 99, f4 = 118, f5 = 96,
  f6 = 97, f7 = 98, f8 = 100, f9 = 101, f10 = 109,
  f11 = 103, f12 = 111, f13 = 105, f14 = 107, f15 = 113,
  f16 = 106, f17 = 64, f18 = 79, f19 = 80, f20 = 90,
}

-- Raw CGEventFlags per modifier, matching osascript-preset exactly: each combines
-- the device-independent mask with the left-key device mask (NX_DEVICEL*KEYMASK).
local sendModFlags = {
  cmd = 1048584,   -- kCGEventFlagMaskCommand   + NX_DEVICELCMDKEYMASK
  alt = 524320,    -- kCGEventFlagMaskAlternate + NX_DEVICELALTKEYMASK
  meta = 524320,   -- alias for alt
  ctrl = 262145,   -- kCGEventFlagMaskControl   + NX_DEVICELCTRLKEYMASK
  shift = 131074,  -- kCGEventFlagMaskShift     + NX_DEVICELSHIFTKEYMASK
  fn = 8388608,    -- kCGEventFlagMaskSecondaryFn
}

local FLAG_FN = 8388608        -- kCGEventFlagMaskSecondaryFn
local FLAG_NUMPAD = 2097152    -- kCGEventFlagMaskNumericPad

-- Synthesize a keystroke carrying exactly the requested modifiers, immune to
-- whatever is physically held when it fires (these presets fire from hyper-key
-- bindings, often with ctrl/cmd held continuously while tapping h/j/k/l).
--
-- This is osascript-preset's EXACT mechanism -- a CGEvent built with a NULL event
-- source, whose flags are set absolutely and therefore never merge with the held
-- hardware modifiers -- but run IN-PROCESS via hs.osascript.javascript, so there's
-- no subprocess and no `hs -c` mach-port race. We tried hs.eventtap first and it
-- failed: its events post through an HID-backed source that ORs in the held
-- modifiers, and the workarounds (rawFlags, releasing modifiers, PID posting)
-- either didn't reach the app or polluted cmd-based shortcuts (copy/paste).
--
-- The `app` argument is accepted for call-site compatibility but unused: a
-- null-source event posted to the session tap already lands on the focused app.
function M.sendKeys(args, app)
  local flags = 0
  local key = nil
  local hasFn = false
  for _, arg in ipairs(args) do
    arg = tostring(arg):lower()
    if arg == "meta" then arg = "alt" end
    local mod = sendModFlags[arg]
    if mod then
      flags = flags + mod
      if arg == "fn" then hasFn = true end
    else
      key = arg
    end
  end
  if not key then return false end

  local code = sendKeyCodes[key]
  if not code then return false end

  -- Arrow keys are only recognized with fn + numericpad flags (matches osascript).
  if key == "left" or key == "right" or key == "up" or key == "down" then
    if not hasFn then flags = flags + FLAG_FN end
    flags = flags + FLAG_NUMPAD
  end

  -- Pre-release the key: when a hyper binding's trigger key is the SAME as this
  -- synthesized key (e.g. ctrl+cmd+h -> ctrl+alt+h), the physical key is still
  -- held, so the synthesized keyDown is a no-op (key already down) and the app
  -- never sees a clean press. A leading keyUp for the same keycode clears that
  -- held state; it's a harmless no-op when the key isn't held.
  local js = string.format(
    'ObjC.import("CoreGraphics");'
    .. 'var p=$.CGEventCreateKeyboardEvent(null,%d,false);$.CGEventPost(1,p);'
    .. 'var d=$.CGEventCreateKeyboardEvent(null,%d,true);$.CGEventSetFlags(d,%d);$.CGEventPost(1,d);'
    .. 'var u=$.CGEventCreateKeyboardEvent(null,%d,false);$.CGEventSetFlags(u,%d);$.CGEventPost(1,u);',
    code, code, flags, code, flags)

  local ok, _, err = hs.osascript.javascript(js)
  if not ok then print("[preset] sendKeys failed: " .. tostring(err)) end
  return ok
end

function M.displayMessage(message, duration)
  -- Center the text so multi-line messages line up under each other.
  hs.alert.show(message, {
    textStyle = { paragraphStyle = { alignment = "center" } },
  }, duration or 0.75)
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
  shell.task({"/usr/bin/osascript", "-e", script}, function(ok)
    if callback then callback(ok) end
  end)
end

M.triggerMenuBarAsync = a.wrap(M.triggerMenuBar)

function M.getActiveApp()
  local app = hs.application.frontmostApplication()
  return app and app:name() or ""
end

function M.getFocusedWindowApp()
  local win = hs.window.focusedWindow()
  if not win then return "" end
  local app = win:application()
  return app and app:name() or ""
end

-- Return the id of the truly focused window. yabai doesn't report the iTerm
-- floating terminal (manage=off) as focused, so it surfaces a background
-- window instead. hs.window.focusedWindow() reports the real focus, and its
-- id is the CGWindowID that matches yabai's window ids.
function M.getFloatingTermOrFocusedWindowId()
  local win = hs.window.focusedWindow()
  if not win then return "" end
  return string.format("%d", win:id())
end

-- True when the focused window is the iTerm2 floating terminal. Its profile
-- names the window "floating-terminal"; in fullscreen iTerm2 prefixes the
-- window number (e.g. "2. floating-terminal"), so match it as a substring.
function M.isFloatingTerminalActive()
  local win = hs.window.focusedWindow()
  if not win then return false end
  local app = win:application()
  return app ~= nil and app:name() == "iTerm2"
    and win:title():find("floating-terminal", 1, true) ~= nil
end

-- True when the focused Ghostty window shows exactly one terminal surface.
--
-- Ghostty exposes no zoom state via AppleScript and draws the terminal grid with
-- Metal. The "Reset (Split) Zoom" button is only a hover affordance, so it can't
-- be relied on. Instead: Ghostty renders only the active tab's surfaces, and a
-- zoomed split collapses the content to a single surface, so count the visible
-- "Terminal content area" AXTextAreas.
--
-- This is a pure-AX check (no AppleScript, which would block the Hammerspoon
-- event loop). Exactly one surface means either zoomed (splits hidden) or a
-- genuine single pane; the caller (ghostty-preset) disambiguates those with the
-- logical split count from AppleScript, run in a subprocess rather than here.
function M.isGhosttyZoomedOrSingleSurface()
  -- Use the globally focused window (not app:focusedWindow) so this also covers
  -- the quick/floating terminal panel, which app:focusedWindow may not return.
  local win = hs.window.focusedWindow()
  local ax = win and hs.axuielement.windowElement(win)
  if not ax then return false end

  local count = 0
  local function walk(el, depth)
    if not el or depth > 12 or count > 1 then return end
    if el:attributeValue("AXRole") == "AXTextArea"
      and el:attributeValue("AXHelp") == "Terminal content area" then
      count = count + 1
    end
    for _, c in ipairs(el:attributeValue("AXChildren") or {}) do
      walk(c, depth + 1)
      if count > 1 then return end
    end
  end
  walk(ax, 0)
  return count == 1
end

-- mosh prepends "[mosh] " to the terminal title while connected, so strip that
-- prefix before matching the underlying program name (e.g. "[mosh] herdr ~").
local function withoutMoshPrefix(title)
  return (title:gsub("^%[mosh%] ", ""))
end

-- The program doesn't always own the title: in dev-preset's --herdr-server mode
-- the remote can write a title naming the command it was handed ("exec env zsh
-- -c herdr", "exec env zsh -c nvim") rather than the program. Accept both shapes.
local function titleRuns(title, program)
  title = withoutMoshPrefix(title)
  return title:sub(1, #program) == program or title:find(" " .. program, 1, true) ~= nil
end

-- True when the focused Ghostty window shows a single surface (a zoomed split or
-- a lone pane) whose program is herdr. The window title reflects the focused
-- surface's title, which herdr sets to "herdr ..." (or "[mosh] herdr ..." over
-- mosh).
function M.isGhosttyHerdrZoomedOrSingleSurface()
  if not M.isGhosttyZoomedOrSingleSurface() then return false end
  local win = hs.window.focusedWindow()
  return titleRuns(win and win:title() or "", "herdr")
end

-- True when the focused Ghostty window shows a single surface (zoomed split or
-- lone pane) running a multiplexer-like app -- nvim or herdr -- so forwarding
-- pane-navigation keys to it makes sense. Identified by the focused surface's
-- title (nvim sets "nvim:...", herdr sets "herdr ...").
function M.isGhosttyMultiplexerZoomedOrSingleSurface()
  if not M.isGhosttyZoomedOrSingleSurface() then return false end
  local win = hs.window.focusedWindow()
  local title = win and win:title() or ""
  return titleRuns(title, "herdr") or titleRuns(title, "nvim")
end

-- True when the focused window is Ghostty's quick (floating) terminal. Ghostty
-- gives that window the AXFloatingWindow subrole (a normal Ghostty window is
-- AXStandardWindow), so match on that. Pure hs.window (no AppleScript).
function M.isGhosttyQuickTerminalActive()
  local win = hs.window.focusedWindow()
  if not win then return false end
  local app = win:application()
  return app ~= nil and app:name() == "Ghostty"
    and win:subrole() == "AXFloatingWindow"
end

-- True when either terminal's floating window is active: the iTerm hotkey window
-- or the Ghostty quick terminal. Mirror of `term-preset is-floating-terminal`.
function M.isFloatingTerminal()
  return M.isFloatingTerminalActive() or M.isGhosttyQuickTerminalActive()
end

function M.getSelectedText()
  local elem = hs.axuielement.systemWideElement()

  local focused = elem:attributeValue("AXFocusedUIElement")

  if focused then
    local text = focused:attributeValue("AXSelectedText")
    if text and text ~= "" then
      return text
    end
  end

  local oldContents = hs.pasteboard.getContents() or ""
  hs.eventtap.keyStroke({"cmd"}, "c")
  hs.timer.usleep(100000)
  local text = hs.pasteboard.getContents() or ""
  hs.pasteboard.setContents(oldContents)

  if text ~= "" and text ~= oldContents then
    return text
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
  -- A floating terminal (iTerm hotkey window / Ghostty quick terminal) is
  -- manage=off, so it can sit on top of whichever app we're alternating to. Hide
  -- whichever is active first (no-op when none is).
  local front = hs.window.focusedWindow():application()
  shell.task({"term-preset", "hide-floating-terminal"})
  if front and front:name() == appName then
    if opts.hide then
      front:hide()
    elseif opts.minimize then
      local win = front:focusedWindow()
      if win then win:minimize() end
    end
  else
    if opts.cmd then
      shell.fish(opts.cmd)
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

_G._savedStackPadding = _G._savedStackPadding or {}

local function isStackFullscreenPadding(padding)
  local count = 0
  for val in padding:gmatch("%-?%d+") do
    count = count + 1
    if math.abs(tonumber(val)) > 15 then return false end
  end
  return count == 4
end

function M.toggleStackFullscreen()
  shell.task({"yabai", "-m", "query", "--spaces", "--space"}, function(ok, output)
    if not ok then return end
    local spaceIdx = tonumber(output:match('"index"%s*:%s*(%d+)'))
    if not spaceIdx then return end

    shell.task({"yabai-preset", "get-stack-padding"}, function(ok2, padding)
      if not ok2 then return end

      if isStackFullscreenPadding(padding) then
        if _G._savedStackPadding[spaceIdx] then
          shell.task({"yabai", "-m", "space", "--padding", "abs:" .. _G._savedStackPadding[spaceIdx]})
          _G._savedStackPadding[spaceIdx] = nil
        else
          shell.task({"yabai-preset", "cycle-stack-padding", "left"})
        end
      else
        _G._savedStackPadding[spaceIdx] = padding
        shell.task({"yabai-preset", "set-stack-default-padding"})
      end
    end)
  end)
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
