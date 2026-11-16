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

local WINDOW_NAME_MAX = 46
local HUD_MAX_ITEMS = 8

local function cleanText(s)
  if type(s) ~= "string" then return "" end
  return (s:gsub("%s+", " "):match("^%s*(.-)%s*$")) or ""
end

local function truncate(s, max)
  local len = utf8.len(s)
  if not len then return #s > max and (s:sub(1, max) .. "…") or s end
  if len <= max then return s end
  return s:sub(1, (utf8.offset(s, max + 1) or (max + 1)) - 1) .. "…"
end

local function shortApp(name)
  if name == "Google Chrome" then return "Chrome" end
  return name
end

local function formatWindowName(id, win)
  local app = cleanText(win and win.app)
  local title = cleanText(win and win.title)
  local short = shortApp(app)
  local label
  if title ~= "" and app ~= "" and title ~= app and title ~= short then
    label = short .. " — " .. title
  elseif title ~= "" then
    label = title
  elseif app ~= "" then
    label = app
  else
    label = "Window " .. tostring(id)
  end
  return truncate(label, WINDOW_NAME_MAX)
end

local function formatHUDLines(items)
  local lines = {}
  local total = #(items or {})
  if total == 0 then return lines end
  local limit = total > HUD_MAX_ITEMS and (HUD_MAX_ITEMS - 1) or total
  for i = 1, limit do
    lines[#lines + 1] = items[i]
  end
  if total > limit then
    lines[#lines + 1] = string.format("+ %d more…", total - limit)
  end
  return lines
end

-- Inspect on-screen CGWindows synchronously in-process. While Mission Control
-- (or App Expose) is up, WindowManager (macOS 27+) or Dock (earlier macOS)
-- owns shield/icon windows at layers 17-19, and the window preview tiles at
-- layer 0 carry their transformed Mission Control bounds in front-to-back
-- order.
local function inspectMissionControl(pt)
  local windows = hs.window.list(true)
  if type(windows) ~= "table" then return false, {}, {} end

  local active = false
  local candidates = {}
  local cgById = {}
  local x = pt and pt.x
  local y = pt and pt.y

  for _, entry in ipairs(windows) do
    local owner = entry.kCGWindowOwnerName
    local layer = entry.kCGWindowLayer
    if (owner == "WindowManager" or owner == "Dock") and type(layer) == "number" and layer >= 17 and layer < 20 then
      active = true
    elseif layer == 0 and not IGNORED_OWNERS[owner or ""] then
      local wid = entry.kCGWindowNumber
      if wid then
        local id = tostring(wid)
        if not cgById[id] then
          cgById[id] = {
            id = wid,
            pid = entry.kCGWindowOwnerPID,
            app = owner,
            title = entry.kCGWindowName,
          }
        end
        local b = entry.kCGWindowBounds
        if x and y and type(b) == "table"
          and x >= b.X and x < (b.X + b.Width)
          and y >= b.Y and y < (b.Y + b.Height) then
          candidates[#candidates + 1] = id
        end
      end
    end
  end

  return active, candidates, cgById
end

local function queryYabaiWindows(callback)
  shell.task({"yabai", "-m", "query", "--windows", print_stdout = false}, function(ok, out)
    local byId = {}
    if ok and out ~= "" then
      local decodedOk, windows = pcall(hs.json.decode, out)
      if decodedOk and type(windows) == "table" then
        for _, w in ipairs(windows) do
          if type(w) == "table" and w.id ~= nil and w.role ~= "AXHelpTag" then
            byId[tostring(w.id)] = w
          end
        end
      end
    end
    callback(byId)
  end)
end

local function withWindowUnderCursor(candidates, callback)
  if not candidates or #candidates == 0 then
    callback(nil, nil, {})
    return
  end

  queryYabaiWindows(function(byId)
    for _, id in ipairs(candidates) do
      if byId[id] then
        callback(id, byId[id], byId)
        return
      end
    end

    callback(candidates[1], nil, byId)
  end)
end

local function lookupWindow(id, byId, cgById)
  id = tostring(id or "")
  local win = byId and byId[id] or nil
  local cg = cgById and cgById[id] or nil
  if win and cg and cleanText(win.title) == "" and cleanText(cg.title) ~= "" then
    return {
      id = win.id or cg.id,
      pid = win.pid or cg.pid,
      app = win.app or cg.app,
      title = cg.title,
    }
  end
  return win or cg
end

local function collectHoldTargets(ids, byId, cgById)
  local windowNames = {}
  local appNames = {}
  local seenApps = {}
  for _, rawId in ipairs(ids or {}) do
    local id = tostring(rawId)
    local win = lookupWindow(id, byId, cgById)
    windowNames[#windowNames + 1] = formatWindowName(id, win)
    local app = cleanText(win and win.app)
    if app ~= "" and not seenApps[app] then
      seenApps[app] = true
      appNames[#appNames + 1] = truncate(app, WINDOW_NAME_MAX)
    end
  end
  return windowNames, appNames
end

local function killWindowApp(win)
  if not win then return end
  local app = (win.pid and hs.application.applicationForPID(win.pid))
    or (win.app and hs.application.find(win.app, true, true))
  if app then app:kill() end
end

local function clearArgListAfterAction()
  ArgList.clear({noRestore = true})
  _G._ArgListSelectionCycleStage = nil
end

local function closeWindowUnderCursor(candidates)
  util.log("missioncontrol: closing window under cursor")
  withWindowUnderCursor(candidates, function(id)
    if not id then return end
    shell.task({"yabai", "-m", "window", id, "--close"})
  end)
end

local function closeArgListWindows(ids)
  ids = (ids and #ids > 0) and ids or ArgList.itemsWithLast()
  if #ids == 0 then return end
  util.log("missioncontrol: closing arglist windows", #ids)
  clearArgListAfterAction()
  for _, id in ipairs(ids) do
    shell.task({"yabai", "-m", "window", tostring(id), "--close"})
  end
end

local function quitAppUnderCursor(candidates)
  util.log("missioncontrol: cmd+right/middle click hold, quitting app under cursor")
  withWindowUnderCursor(candidates, function(id, win)
    if not id or not win then return end
    killWindowApp(win)
  end)
end

local function quitArgListApps(ids, byId, cgById)
  ids = (ids and #ids > 0) and ids or ArgList.itemsWithLast()
  if #ids == 0 then return end
  util.log("missioncontrol: cmd+right click hold, quitting arglist apps for windows", #ids)

  local function run(windowMap)
    local _, _, currentCgById = inspectMissionControl(nil)
    local fallbackCg = cgById or currentCgById
    local killedPids = {}
    local killedApps = {}
    for _, rawId in ipairs(ids) do
      local id = tostring(rawId)
      local win = lookupWindow(id, windowMap, fallbackCg)
      if win then
        local pidKey = win.pid and tostring(win.pid) or nil
        local appKey = cleanText(win.app)
        if appKey == "" then appKey = nil end
        if not (pidKey and killedPids[pidKey]) and not (appKey and killedApps[appKey]) then
          if pidKey then killedPids[pidKey] = true end
          if appKey then killedApps[appKey] = true end
          killWindowApp(win)
        end
      end
    end
    clearArgListAfterAction()
  end

  if byId then
    run(byId)
  else
    queryYabaiWindows(run)
  end
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
--   right click, hold 1s                -> close that window (or all ArgList windows if hovering an ArgList window)
--   Cmd+right, hold 1s                  -> quit that window's app (or all ArgList apps if hovering an ArgList window)
--   middle click, hold 1s               -> quit that window's app
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
local HUD_WIDTH, HUD_BASE_HEIGHT = 400, 220
local HUD_LINE_HEIGHT = 20
local HUD_BG, HUD_PROGRESS, HUD_GLYPH, HUD_TITLE, HUD_ITEMS, HUD_STATUS = 1, 3, 5, 6, 7, 8
local HUD_COLORS = {
  background = { white = 0.06, alpha = 0.88 },
  border = { white = 1.0, alpha = 0.14 },
  text = { white = 1.0, alpha = 1.0 },
  itemText = { white = 0.92, alpha = 0.92 },
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
  --   >= 1s hold      -> close window(s) (right) or quit app(s) (Cmd+right / middle)
  local holdingButton = nil -- "right" | "middle" | nil
  local holdFired = false
  local holdCmd = false
  local holdCandidates = nil
  local holdCgById = nil
  local holdWindowsById = nil
  local holdResolved = false
  local holdIsArgList = false
  local holdArgListIds = nil
  local holdWindowNames = nil
  local holdAppNames = nil
  local holdStartedAt = nil
  local holdSeq = 0
  local progressTimer, hud, hudVisible, hudCurrentHeight = nil, nil, false, HUD_BASE_HEIGHT

  local function ensureHUD()
    if hud then return hud end
    hud = hs.canvas.new({ x = 0, y = 0, w = HUD_WIDTH, h = HUD_BASE_HEIGHT })
    hud:level("overlay")
    hud:behavior({ "canJoinAllSpaces", "stationary" })
    hud:clickActivating(false)
    hud:appendElements({
      { type = "rectangle", action = "strokeAndFill",
        frame = { x = 0, y = 0, w = HUD_WIDTH, h = HUD_BASE_HEIGHT },
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
        frame = { x = 24, y = 138, w = HUD_WIDTH - 48, h = 28 },
        textSize = 20, textAlignment = "center", textLineBreak = "truncateTail", textColor = HUD_COLORS.text },
      { type = "text", action = "fill", text = "",
        frame = { x = 24, y = 170, w = HUD_WIDTH - 48, h = 0 },
        textSize = 14, textAlignment = "center", textLineBreak = "clip", textColor = HUD_COLORS.itemText },
      { type = "text", action = "fill", text = "Release to cancel",
        frame = { x = 24, y = 174, w = HUD_WIDTH - 48, h = 28 },
        textSize = 14, textAlignment = "center", textColor = HUD_COLORS.muted },
    })
    hudCurrentHeight = HUD_BASE_HEIGHT
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
    holdCgById = nil
    holdWindowsById = nil
    holdResolved = false
    holdIsArgList = false
    holdArgListIds = nil
    holdWindowNames = nil
    holdAppNames = nil
  end

  _G.MissionControlHoldCleanup = function()
    cancelHold()
    if hud then hud:delete(); hud = nil end
    holdFired = false
  end

  local function isQuitHold()
    return holdingButton == "middle" or holdCmd
  end

  local function applyResolvedTarget(button, id, byId, cgById)
    local useArgList = (button == "right") and not ArgList.isEmpty() and (id ~= nil and ArgList.contains(id))
    holdIsArgList = useArgList
    if useArgList then
      local ids = ArgList.itemsWithLast()
      holdArgListIds = ids
      holdWindowNames, holdAppNames = collectHoldTargets(ids, byId, cgById)
    else
      holdArgListIds = nil
      local targetIds = id and { id } or {}
      holdWindowNames, holdAppNames = collectHoldTargets(targetIds, byId, cgById)
    end
  end

  local function holdLabels()
    if isQuitHold() then
      local apps = holdAppNames or {}
      local count = #apps
      local title = count > 1 and ("Hold to quit " .. count .. " apps") or "Hold to quit app"
      return title, "⏻", formatHUDLines(apps)
    end
    local windows = holdWindowNames or {}
    local count = #windows
    local title = count > 1 and ("Hold to close " .. count .. " windows") or "Hold to close window"
    return title, "✕", formatHUDLines(windows)
  end

  local function renderHUD(elapsed)
    local c = ensureHUD()
    local title, glyph, lines = holdLabels()
    local lineCount = #lines
    local itemsHeight = lineCount > 0 and (lineCount * HUD_LINE_HEIGHT + 4) or 0
    local statusY = lineCount > 0 and (170 + itemsHeight + 8) or 174
    local hudHeight = lineCount > 0 and (statusY + 28 + 16) or HUD_BASE_HEIGHT

    if not hudVisible or hudCurrentHeight ~= hudHeight then
      local screen = (hs.mouse.getCurrentScreen and hs.mouse.getCurrentScreen()) or hs.screen.mainScreen()
      local sf = screen:frame()
      c:frame({
        x = math.floor(sf.x + (sf.w - HUD_WIDTH) / 2),
        y = math.floor(sf.y + (sf.h - hudHeight) / 2),
        w = HUD_WIDTH,
        h = hudHeight,
      })
      c:elementAttribute(HUD_BG, "frame", { x = 0, y = 0, w = HUD_WIDTH, h = hudHeight })
      c:elementAttribute(HUD_ITEMS, "frame", { x = 24, y = 170, w = HUD_WIDTH - 48, h = itemsHeight })
      c:elementAttribute(HUD_STATUS, "frame", { x = 24, y = statusY, w = HUD_WIDTH - 48, h = 28 })
      hudCurrentHeight = hudHeight
      if not hudVisible then
        c:show()
        hudVisible = true
      end
    end

    local progress = math.min(1, math.max(0, elapsed / HOLD_SECONDS))
    -- A 360° arc collapses to an empty path; keep it just shy of full.
    c:elementAttribute(HUD_PROGRESS, "endAngle", -90 + (progress >= 1 and 359.9 or 360 * progress))
    c:elementAttribute(HUD_GLYPH, "text", glyph)
    c:elementAttribute(HUD_TITLE, "text", title)
    c:elementAttribute(HUD_ITEMS, "text", table.concat(lines, "\n"))
    c:elementAttribute(HUD_STATUS, "text",
      string.format("Release to cancel · %.1fs", math.max(0, HOLD_SECONDS - elapsed)))
  end

  local function executeHoldAction(button, candidates, quit, resolved, useArgList, argListIds, byId, cgById)
    local function run(isArgList, ids, windowMap)
      if isArgList then
        if quit then
          quitArgListApps(ids, windowMap, cgById)
        else
          closeArgListWindows(ids)
        end
      elseif quit then
        quitAppUnderCursor(candidates)
      else
        closeWindowUnderCursor(candidates)
      end
    end

    if resolved then
      run(useArgList, argListIds, byId)
      return
    end

    withWindowUnderCursor(candidates, function(id, _, windowMap)
      local isArgList = (button == "right") and not ArgList.isEmpty() and (id ~= nil and ArgList.contains(id))
      run(isArgList, isArgList and ArgList.itemsWithLast() or nil, windowMap)
    end)
  end

  local function tickHold()
    if not holdingButton or not holdStartedAt then return end

    holdCmd = hs.eventtap.checkKeyboardModifiers().cmd and true or false
    local elapsed = hs.timer.secondsSinceEpoch() - holdStartedAt

    if elapsed >= HOLD_SECONDS then
      local button = holdingButton
      local candidates = holdCandidates
      local quit = isQuitHold()
      local resolved = holdResolved
      local useArgList = holdIsArgList
      local argListIds = holdArgListIds
      local byId = holdWindowsById
      local cgById = holdCgById
      cancelHold()
      -- The release that follows must not also run the quick action.
      holdFired = true
      -- Mission Control may have been dismissed mid-hold; don't act blind.
      if not (inspectMissionControl(nil)) then return end
      executeHoldAction(button, candidates, quit, resolved, useArgList, argListIds, byId, cgById)
      return
    end

    if elapsed >= HUD_SHOW_DELAY then
      renderHUD(elapsed)
    end
  end

  local function startHold(button, candidates, cmd, cgById)
    cancelHold()
    holdFired = false
    holdingButton = button
    holdCmd = cmd
    holdCandidates = candidates
    holdCgById = cgById
    holdStartedAt = hs.timer.secondsSinceEpoch()
    applyResolvedTarget(button, candidates[1], nil, cgById)
    holdSeq = holdSeq + 1
    local seq = holdSeq
    util.log("missioncontrol: startHold", button, "candidates=", #candidates, "cmd=", tostring(cmd))
    withWindowUnderCursor(candidates, function(id, _, byId)
      if not holdingButton or seq ~= holdSeq then return end
      holdResolved = true
      holdWindowsById = byId
      applyResolvedTarget(button, id, byId, cgById)
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
      local active, candidates, cgById = inspectMissionControl(event:location())
      swallowingRight = active
      if active then
        util.log("missioncontrol: rightMouseDown active=true candidates=", #candidates)
      end
      if active and candidates and #candidates > 0 then
        startHold("right", candidates, event:getFlags().cmd and true or false, cgById)
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
      local active, candidates, cgById = inspectMissionControl(event:location())
      swallowingMiddle = active
      if active then
        util.log("missioncontrol: otherMouseDown active=true candidates=", #candidates)
      end
      if active and candidates and #candidates > 0 then
        startHold("middle", candidates, true, cgById)
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
