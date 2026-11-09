local shell = require("shell")
local util = require("util")
local ArgList = require("arglist")
local Preset = require("preset")

local M = {}

local eventTypes = hs.eventtap.event.types
local eventProps = hs.eventtap.event.properties

local IGNORED_OWNERS = {
  ["WindowManager"] = true,
  ["Dock"] = true,
  ["Window Server"] = true,
  ["Wallpaper"] = true,
  ["Notification Center"] = true,
  ["borders"] = true,
  ["hs"] = true,
  ["Mouseless"] = true,
  ["BetterDisplay"] = true,
}

-- Inspect on-screen CGWindows synchronously in-process. While Mission Control
-- (or App Expose) is up, WindowManager (macOS 27+) or Dock (earlier macOS)
-- owns shield/icon windows at layers 17-19, and the window preview tiles at
-- layer 0 carry their transformed Mission Control bounds in front-to-back
-- order.
local function inspectMissionControl(pt)
  local windows = hs.window.list(true)
  if type(windows) ~= "table" then return false, {} end

  local active = false
  local candidates = {}
  local x = pt and pt.x
  local y = pt and pt.y

  for _, entry in ipairs(windows) do
    local owner = entry.kCGWindowOwnerName
    local layer = entry.kCGWindowLayer
    if (owner == "WindowManager" or owner == "Dock") and type(layer) == "number" and layer >= 17 and layer < 20 then
      active = true
    elseif x and y and layer == 0 and not IGNORED_OWNERS[owner or ""] then
      local b = entry.kCGWindowBounds
      local wid = entry.kCGWindowNumber
      if type(b) == "table" and wid
        and x >= b.X and x < (b.X + b.Width)
        and y >= b.Y and y < (b.Y + b.Height) then
        candidates[#candidates + 1] = tostring(wid)
      end
    end
  end

  return active, candidates
end

local function withWindowUnderCursor(candidates, callback)
  if not candidates or #candidates == 0 then
    callback(nil, nil)
    return
  end

  shell.task({"yabai", "-m", "query", "--windows", print_stdout = false}, function(ok, out)
    if ok and out ~= "" then
      local decodedOk, windows = pcall(hs.json.decode, out)
      if decodedOk and type(windows) == "table" then
        local byId = {}
        for _, w in ipairs(windows) do
          if type(w) == "table" and w.id ~= nil and w.role ~= "AXHelpTag" then
            byId[tostring(w.id)] = w
          end
        end
        for _, id in ipairs(candidates) do
          if byId[id] then
            callback(id, byId[id])
            return
          end
        end
      end
    end

    callback(candidates[1], nil)
  end)
end

local function closeWindowUnderCursor(candidates)
  util.log("missioncontrol: closing window under cursor")
  withWindowUnderCursor(candidates, function(id)
    if not id then return end
    shell.task({"yabai", "-m", "window", id, "--close"})
  end)
end

local function quitAppUnderCursor(candidates)
  util.log("missioncontrol: cmd+right click hold, quitting app under cursor")
  withWindowUnderCursor(candidates, function(id, win)
    if not id or not win then return end
    local app = (win.pid and hs.application.applicationForPID(win.pid))
      or (win.app and hs.application.find(win.app, true, true))
    if app then app:kill() end
  end)
end

local function toggleWindowUnderCursorInArgList(candidates)
  util.log("missioncontrol: right click, toggling window under cursor in arglist")
  withWindowUnderCursor(candidates, function(id)
    if not id then
      Preset.displayMessage("ArgList: no window under cursor")
      return
    end

    local action = ArgList.toggle(id)
    if action == "added" then ArgList.noteFocused(id) end
    local verb = action == "added" and "Marked" or "Unmarked"
    Preset.displayMessage(verb .. " window " .. id .. " (" .. ArgList.count() .. " marked)")
  end)
end

-- While Mission Control is on screen:
--   right click (< 0.2s)                -> toggle the tile under the cursor in ArgList (mark)
--   Cmd+right / middle click (< 0.2s)   -> close that window
--   hold > 0.2s                         -> show countdown HUD; releasing before 1s cancels (no action)
--   right click, hold 1s                -> close that window
--   Cmd+right / middle click, hold 1s   -> quit that window's app
-- On macOS 27+, WindowManager treats right/middle clicks on Mission Control
-- tiles as window-selection clicks unless the click is swallowed, and its
-- ExposeShieldWindow sits above the tiles so yabai's `mouse` selector cannot
-- see them. We check hs.window.list(true) in-process to swallow right/middle
-- clicks while Mission Control is open and resolve the tile under the cursor
-- from its CGWindow bounds.
local HOLD_SECONDS = 1
local HUD_SHOW_DELAY = 0.2

-- Mac Mouse Fix Helper installs its CGEventTap at kCGHIDEventTap (0), whereas
-- hs.eventtap:start() installs at kCGSessionEventTap (1). That lets Mac Mouse
-- Fix swallow physical middle-button (Button 3) presses before Hammerspoon sees
-- them and replace a hold with a synthetic 0ms click. Starting our tap at
-- kCGHIDEventTap with kCGHeadInsertEventTap places it ahead of Mac Mouse Fix so
-- Mission Control sees the real physical middle-button press and release.
local HIDTAP_SO = "/tmp/hs_hidtap.so"
local HIDTAP_C = [[
#include <ApplicationServices/ApplicationServices.h>
#include <dlfcn.h>
#include <lua.h>
#include <lauxlib.h>

typedef struct {
    int callbackRef;
    CGEventMask mask;
    CFMachPortRef tap;
    CFRunLoopSourceRef runloopSrc;
} eventtap_t;

static int start_hid(lua_State *L) {
    eventtap_t *e = (eventtap_t *)luaL_checkudata(L, 1, "hs.eventtap");
    if (e->tap && CGEventTapIsEnabled(e->tap)) {
        lua_settop(L, 1);
        return 1;
    }
    void *h = dlopen("/Applications/Hammerspoon.app/Contents/Frameworks/hs/libeventtap.dylib", RTLD_NOLOAD | RTLD_LAZY);
    CGEventTapCallBack cb = (CGEventTapCallBack)dlsym(h ? h : RTLD_DEFAULT, "eventtap_callback");
    if (!cb) return luaL_error(L, "eventtap_callback symbol not found");

    if (e->tap) {
        CFMachPortInvalidate(e->tap);
        if (e->runloopSrc) {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), e->runloopSrc, kCFRunLoopCommonModes);
            CFRelease(e->runloopSrc);
            e->runloopSrc = NULL;
        }
        CFRelease(e->tap);
        e->tap = NULL;
    }

    e->tap = CGEventTapCreate(
        kCGHIDEventTap,
        kCGHeadInsertEventTap,
        kCGEventTapOptionDefault,
        e->mask,
        cb,
        e
    );
    if (!e->tap) return luaL_error(L, "CGEventTapCreate(kCGHIDEventTap) failed");

    CGEventTapEnable(e->tap, true);
    e->runloopSrc = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, e->tap, 0);
    CFRunLoopAddSource(CFRunLoopGetMain(), e->runloopSrc, kCFRunLoopCommonModes);
    lua_settop(L, 1);
    return 1;
}

int luaopen_hs_hidtap(lua_State *L) {
    lua_pushcfunction(L, start_hid);
    return 1;
}
]]

local startHIDTap = nil
local function startEventTapAtHID(tap)
  if not startHIDTap then
    if not hs.fs.attributes(HIDTAP_SO, "mode") then
      local cPath = "/tmp/hs_hidtap.c"
      local f = io.open(cPath, "w")
      if f then
        f:write(HIDTAP_C)
        f:close()
        os.execute(
          "/usr/bin/clang -O2 -bundle -undefined dynamic_lookup"
          .. " -I/Applications/Hammerspoon.app/Contents/Frameworks/LuaSkin.framework/Versions/A/Headers"
          .. " -framework ApplicationServices -framework CoreFoundation "
          .. cPath .. " -o " .. HIDTAP_SO
        )
      end
    end
    local loader = package.loadlib(HIDTAP_SO, "luaopen_hs_hidtap")
    if loader then
      local ok, fn = pcall(loader)
      if ok and type(fn) == "function" then startHIDTap = fn end
    end
  end
  if startHIDTap then
    local ok = pcall(startHIDTap, tap)
    if ok then return end
  end
  tap:start()
end

-- Hold-progress HUD, mirroring HoldToQuit.spoon's canvas (same size, ring
-- and colors) so holding right click reads like holding Cmd+Q.
local HUD_WIDTH, HUD_HEIGHT = 360, 220
local HUD_PROGRESS, HUD_GLYPH, HUD_TITLE, HUD_STATUS = 3, 5, 6, 7
local HUD_COLORS = {
  background = { white = 0.06, alpha = 0.88 },
  border = { white = 1.0, alpha = 0.14 },
  text = { white = 1.0, alpha = 1.0 },
  muted = { white = 1.0, alpha = 0.68 },
  track = { white = 1.0, alpha = 0.16 },
  progress = { red = 0.25, green = 0.62, blue = 1.0, alpha = 0.96 },
  keyBackground = { white = 1.0, alpha = 0.11 },
}

function M.setup()
  if _G.MissionControlMouseClick then
    pcall(function() _G.MissionControlMouseClick:stop() end)
  end
  if _G.MissionControlHoldCleanup then
    pcall(_G.MissionControlHoldCleanup)
    _G.MissionControlHoldCleanup = nil
  end

  local swallowingRight = false
  local swallowingMiddle = false

  -- Hold state (shared by right click and middle click):
  --   < 0.2s release  -> single-click action (no HUD shown)
  --   0.2s..1s hold   -> countdown HUD shown; release cancels without action
  --   >= 1s hold      -> close window (right) or quit app (Cmd+right / middle)
  local holdingButton = nil -- "right" | "middle" | nil
  local holdFired = false
  local holdCmd = false
  local holdCandidates = nil
  local holdStartedAt = nil
  local holdAppName = nil
  local holdSeq = 0
  local progressTimer, hud, hudVisible = nil, nil, false

  local function ensureHUD()
    if hud then return hud end
    hud = hs.canvas.new({ x = 0, y = 0, w = HUD_WIDTH, h = HUD_HEIGHT })
    hud:level("overlay")
    hud:behavior({ "canJoinAllSpaces", "stationary" })
    hud:clickActivating(false)
    hud:appendElements({
      { type = "rectangle", action = "strokeAndFill",
        frame = { x = 0, y = 0, w = HUD_WIDTH, h = HUD_HEIGHT },
        roundedRectRadii = { xRadius = 20, yRadius = 20 },
        fillColor = HUD_COLORS.background, strokeColor = HUD_COLORS.border, strokeWidth = 1,
        withShadow = true, shadow = { blurRadius = 24, color = { white = 0, alpha = 0.42 }, offset = { h = -2, w = 0 } } },
      { type = "circle", action = "stroke", center = { x = HUD_WIDTH / 2, y = 82 }, radius = 44,
        strokeColor = HUD_COLORS.track, strokeWidth = 8 },
      { type = "arc", action = "stroke", center = { x = HUD_WIDTH / 2, y = 82 }, radius = 44,
        startAngle = -90, endAngle = -90, arcClockwise = true, arcRadii = false,
        strokeColor = HUD_COLORS.progress, strokeWidth = 8, strokeCapStyle = "round" },
      { type = "rectangle", action = "fill",
        frame = { x = HUD_WIDTH / 2 - 26, y = 62, w = 52, h = 40 },
        roundedRectRadii = { xRadius = 10, yRadius = 10 }, fillColor = HUD_COLORS.keyBackground },
      { type = "text", action = "fill", text = "✕",
        frame = { x = HUD_WIDTH / 2 - 60, y = 68, w = 120, h = 32 },
        textSize = 24, textAlignment = "center", textColor = HUD_COLORS.text },
      { type = "text", action = "fill", text = "Hold to close window",
        frame = { x = 24, y = 140, w = HUD_WIDTH - 48, h = 34 },
        textSize = 20, textAlignment = "center", textColor = HUD_COLORS.text },
      { type = "text", action = "fill", text = "Release to cancel",
        frame = { x = 24, y = 174, w = HUD_WIDTH - 48, h = 28 },
        textSize = 14, textAlignment = "center", textColor = HUD_COLORS.muted },
    })
    return hud
  end

  local function hideHUD()
    if hud and hudVisible then
      hud:hide()
      hudVisible = false
    end
  end

  local function stopHoldTimer()
    if progressTimer then
      progressTimer:stop()
      progressTimer = nil
    end
  end

  local function cancelHold()
    stopHoldTimer()
    hideHUD()
    holdingButton = nil
    holdStartedAt = nil
    holdCandidates = nil
    holdAppName = nil
  end

  _G.MissionControlHoldCleanup = function()
    cancelHold()
    if hud then hud:delete(); hud = nil end
    holdFired = false
  end

  local function isQuitHold()
    return holdingButton == "middle" or holdCmd
  end

  local function holdLabels()
    if isQuitHold() then
      return "Hold to quit " .. (holdAppName or "app"), "⏻"
    end
    return "Hold to close window", "✕"
  end

  local function renderHUD(elapsed)
    local c = ensureHUD()
    if not hudVisible then
      local screen = (hs.mouse.getCurrentScreen and hs.mouse.getCurrentScreen()) or hs.screen.mainScreen()
      local sf = screen:frame()
      c:topLeft({
        x = math.floor(sf.x + (sf.w - HUD_WIDTH) / 2),
        y = math.floor(sf.y + (sf.h - HUD_HEIGHT) / 2),
      })
      c:show()
      hudVisible = true
    end
    local progress = math.min(1, math.max(0, elapsed / HOLD_SECONDS))
    -- A 360° arc collapses to an empty path; keep it just shy of full.
    c:elementAttribute(HUD_PROGRESS, "endAngle", -90 + (progress >= 1 and 359.9 or 360 * progress))
    local title, glyph = holdLabels()
    c:elementAttribute(HUD_GLYPH, "text", glyph)
    c:elementAttribute(HUD_TITLE, "text", title)
    c:elementAttribute(HUD_STATUS, "text",
      string.format("Release to cancel · %.1fs", math.max(0, HOLD_SECONDS - elapsed)))
  end

  local function tickHold()
    if not holdingButton or not holdStartedAt then return end

    holdCmd = hs.eventtap.checkKeyboardModifiers().cmd and true or false
    local elapsed = hs.timer.secondsSinceEpoch() - holdStartedAt

    if elapsed >= HOLD_SECONDS then
      local candidates, quit = holdCandidates, isQuitHold()
      cancelHold()
      -- The release that follows must not also run the quick action.
      holdFired = true
      -- Mission Control may have been dismissed mid-hold; don't act blind.
      if not (inspectMissionControl(nil)) then return end
      if quit then
        quitAppUnderCursor(candidates)
      else
        closeWindowUnderCursor(candidates)
      end
      return
    end

    if elapsed >= HUD_SHOW_DELAY then
      renderHUD(elapsed)
    end
  end

  local function startHold(button, candidates, cmd)
    cancelHold()
    holdFired = false
    holdingButton = button
    holdCmd = cmd
    holdCandidates = candidates
    holdStartedAt = hs.timer.secondsSinceEpoch()
    holdSeq = holdSeq + 1
    local seq = holdSeq
    util.log("missioncontrol: startHold", button, "candidates=", #candidates, "cmd=", tostring(cmd))
    withWindowUnderCursor(candidates, function(_, win)
      if not holdingButton or seq ~= holdSeq then return end
      holdAppName = win and win.app or nil
    end)
    progressTimer = hs.timer.doEvery(1 / 30, tickHold)
  end

  local function finishHoldOrClick(button, swallow, event)
    if not swallow then return false end
    if holdFired then
      holdFired = false
      return true
    end
    local heldCandidates = holdCandidates
    local wasHolding = (holdingButton == button)
    local elapsed = (wasHolding and holdStartedAt) and (hs.timer.secondsSinceEpoch() - holdStartedAt) or 0
    local wasCountdownShown = hudVisible or elapsed >= HUD_SHOW_DELAY
    if wasHolding then cancelHold() end
    -- Held past 0.2s (countdown shown) then released before 1s: cancel with no action.
    if wasCountdownShown then
      util.log("missioncontrol: hold cancelled after", string.format("%.2fs", elapsed))
      return true
    end
    local active, candidates = inspectMissionControl(event:location())
    if active then
      local target = (wasHolding and heldCandidates) or candidates
      if button == "middle" or event:getFlags().cmd then
        closeWindowUnderCursor(target)
      else
        toggleWindowUnderCursorInArgList(target)
      end
    end
    return true
  end

  local tap = hs.eventtap.new({
    eventTypes.rightMouseDown,
    eventTypes.rightMouseDragged,
    eventTypes.rightMouseUp,
    eventTypes.otherMouseDown,
    eventTypes.otherMouseDragged,
    eventTypes.otherMouseUp,
  }, function(event)
    local eventType = event:getType()

    if eventType == eventTypes.rightMouseDown then
      local active, candidates = inspectMissionControl(event:location())
      swallowingRight = active
      if active then
        util.log("missioncontrol: rightMouseDown active=true candidates=", #candidates)
      end
      if active and candidates and #candidates > 0 then
        startHold("right", candidates, event:getFlags().cmd and true or false)
      end
      return active
    elseif eventType == eventTypes.rightMouseDragged then
      return swallowingRight
    elseif eventType == eventTypes.rightMouseUp then
      local swallow = swallowingRight
      swallowingRight = false
      return finishHoldOrClick("right", swallow, event)
    end

    local button = event:getProperty(eventProps.mouseEventButtonNumber)
    if button ~= 2 then return false end

    if eventType == eventTypes.otherMouseDown then
      local active, candidates = inspectMissionControl(event:location())
      swallowingMiddle = active
      if active then
        util.log("missioncontrol: otherMouseDown active=true candidates=", #candidates)
      end
      if active and candidates and #candidates > 0 then
        startHold("middle", candidates, true)
      end
      return active
    elseif eventType == eventTypes.otherMouseDragged then
      return swallowingMiddle
    elseif eventType == eventTypes.otherMouseUp then
      local swallow = swallowingMiddle
      swallowingMiddle = false
      return finishHoldOrClick("middle", swallow, event)
    end

    return false
  end)

  startEventTapAtHID(tap)
  _G.MissionControlMouseClick = tap
  _G.MissionControlRightClick = tap
end

return M
