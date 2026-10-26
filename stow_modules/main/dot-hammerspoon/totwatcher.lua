local util = require("util")
local Preset = require("preset")
local GhosttyPreset = require("ghosttyPreset")

-- Automatically hides Tot whenever its window loses focus.
--
-- Event-driven (like zoomwatcher.lua and focushistory.lua), deliberately avoiding
-- hs.window.filter so config reloads stay fast:
--   * hs.application.watcher -- Tot activating/deactivating/launching/terminating,
--                               and other apps activating.
--   * hs.uielement.watcher   -- on Tot and its windows: focusedWindowChanged,
--                               mainWindowChanged, windowCreated, elementDestroyed,
--                               windowMinimized.
--   * hs.spaces.watcher      -- active Space changes (e.g. swiping to an empty
--                               Space where no other app activates).
--   * M.notifyFocusChanged() -- called from focushistory's per-app AX observers so
--                               non-activating panels (like the Ghostty quick
--                               terminal) stealing focus from Tot are caught too.
local M = {}

local BUNDLE = "com.iconfactory.Tot"
local APP_NAME = "Tot"
local SETTLE = 0.05
local ACTIVATE_RETRY_MAX = 6

local appWatcher
local spaceWatcher
local totWatcher
local windowWatchers
local settleTimer
local activateTimer
local totFocused = false
local pendingDeactivate = false

local function isTotApp(app)
  if not app then return false end
  return app:bundleID() == BUNDLE or app:name() == APP_NAME
end

local function totApp()
  return hs.application.get(BUNDLE) or hs.application.get(APP_NAME)
end

local function isTotWindowFocused()
  local win = hs.window.focusedWindow()
  if not win then return false end
  return isTotApp(win:application())
end

local function totHasFocus(app)
  app = app or totApp()
  if not app or app:isHidden() then return false end
  if not isTotApp(hs.application.frontmostApplication()) then return false end
  return isTotWindowFocused()
end

local function cancelSettle()
  if settleTimer then
    settleTimer:stop()
    settleTimer = nil
  end
end

local function cancelActivateRetry()
  if activateTimer then
    activateTimer:stop()
    activateTimer = nil
  end
end

local function hideTot(reason)
  cancelActivateRetry()
  local app = totApp()
  totFocused = false
  pendingDeactivate = false
  if not app or app:isHidden() then return end

  -- If the Ghostty quick terminal (a non-activating panel) took focus while Tot
  -- was still frontmost, hiding Tot makes macOS activate the underlying app,
  -- which can trigger Ghostty's quick-terminal-autohide. Re-reveal it if needed.
  local restoreGhosttyQuick = Preset.isGhosttyQuickTerminalActive()
  util.log("totwatcher: hiding Tot (" .. (reason or "focus lost") .. ")")
  app:hide()

  if restoreGhosttyQuick then
    hs.timer.doAfter(SETTLE, function()
      GhosttyPreset.revealFloatingTerminal()
    end)
  end
end

local function refresh()
  local app = totApp()
  if not app or app:isHidden() then
    totFocused = false
    pendingDeactivate = false
    return
  end

  if totHasFocus(app) then
    totFocused = true
    pendingDeactivate = false
    return
  end

  if totFocused or pendingDeactivate then
    hideTot("window lost focus")
  end
end

local function scheduleRefresh(delay)
  cancelSettle()
  settleTimer = hs.timer.doAfter(delay or SETTLE, function()
    settleTimer = nil
    refresh()
  end)
end

-- When Tot activates, AX focus can settle a beat after NSWorkspace posts the
-- activation notification (especially if Preset.alternateApp is hiding a
-- floating terminal at the same time). Retry briefly while Tot remains frontmost
-- so totFocused is reliably armed even if AXFocusedWindowChanged does not re-fire.
local function waitForFocusOnActivate()
  cancelActivateRetry()
  local tries = 0
  local function attempt()
    activateTimer = nil
    local app = totApp()
    if not app or app:isHidden() then return end
    if totHasFocus(app) then
      totFocused = true
      pendingDeactivate = false
      return
    end
    if not isTotApp(hs.application.frontmostApplication()) then
      if totFocused or pendingDeactivate then hideTot("deactivated during open") end
      return
    end
    tries = tries + 1
    if tries < ACTIVATE_RETRY_MAX then
      activateTimer = hs.timer.doAfter(SETTLE, attempt)
    end
  end
  activateTimer = hs.timer.doAfter(SETTLE, attempt)
end

local function watchWindow(win)
  local id = win and win:id()
  if not id or windowWatchers[id] then return end

  local ok, watcher = pcall(function()
    return win:newWatcher(function(_, event)
      if event == hs.uielement.watcher.elementDestroyed then
        windowWatchers[id] = nil
      end
      scheduleRefresh()
    end)
  end)
  if not ok or not watcher then return end

  windowWatchers[id] = watcher
  watcher:start({
    hs.uielement.watcher.elementDestroyed,
    hs.uielement.watcher.windowMinimized,
  })
end

local function detach()
  cancelSettle()
  cancelActivateRetry()
  if totWatcher then
    pcall(function() totWatcher:stop() end)
    totWatcher = nil
  end
  for _, w in pairs(windowWatchers or {}) do
    pcall(function() w:stop() end)
  end
  windowWatchers = {}
  totFocused = false
  pendingDeactivate = false
  _G.TotWatcher.app = nil
  _G.TotWatcher.windows = windowWatchers
end

local function attach(app)
  detach()
  if not app then return end

  local ok, watcher = pcall(function()
    return app:newWatcher(function(element, event)
      if event == hs.uielement.watcher.windowCreated then
        watchWindow(element)
      end
      scheduleRefresh()
    end)
  end)
  if not ok or not watcher then return end

  totWatcher = watcher
  totWatcher:start({
    hs.uielement.watcher.applicationActivated,
    hs.uielement.watcher.applicationDeactivated,
    hs.uielement.watcher.applicationHidden,
    hs.uielement.watcher.applicationShown,
    hs.uielement.watcher.focusedWindowChanged,
    hs.uielement.watcher.mainWindowChanged,
    hs.uielement.watcher.windowCreated,
  })
  _G.TotWatcher.app = totWatcher

  for _, w in ipairs(app:allWindows()) do watchWindow(w) end
  if totHasFocus(app) then
    totFocused = true
  end
end

function M.notifyFocusChanged()
  if totFocused or pendingDeactivate then
    scheduleRefresh()
  end
end

function M.setup()
  if _G.TotWatcher then
    if _G.TotWatcher.appWatcher then pcall(function() _G.TotWatcher.appWatcher:stop() end) end
    if _G.TotWatcher.spaceWatcher then pcall(function() _G.TotWatcher.spaceWatcher:stop() end) end
    if _G.TotWatcher.app then pcall(function() _G.TotWatcher.app:stop() end) end
    for _, w in pairs(_G.TotWatcher.windows or {}) do pcall(function() w:stop() end) end
  end

  _G.TotWatcher = {}
  windowWatchers = {}

  appWatcher = hs.application.watcher.new(function(_, event, app)
    if event == hs.application.watcher.terminated then
      if totWatcher and app and app:pid() == totWatcher:pid() then
        detach()
      end
      return
    end

    if isTotApp(app) then
      if event == hs.application.watcher.launched then
        attach(app)
      elseif event == hs.application.watcher.activated then
        if not totWatcher then attach(app) end
        pendingDeactivate = false
        waitForFocusOnActivate()
      elseif event == hs.application.watcher.unhidden then
        if not totWatcher then attach(app) end
        waitForFocusOnActivate()
      elseif event == hs.application.watcher.deactivated then
        pendingDeactivate = true
        scheduleRefresh()
      elseif event == hs.application.watcher.hidden then
        cancelSettle()
        cancelActivateRetry()
        totFocused = false
        pendingDeactivate = false
      end
      return
    end

    if event == hs.application.watcher.activated then
      if totFocused or pendingDeactivate then
        scheduleRefresh()
      end
    end
  end)
  appWatcher:start()
  _G.TotWatcher.appWatcher = appWatcher

  spaceWatcher = hs.spaces.watcher.new(function()
    if totFocused or pendingDeactivate then
      scheduleRefresh()
    end
  end)
  spaceWatcher:start()
  _G.TotWatcher.spaceWatcher = spaceWatcher

  local app = totApp()
  if app then
    attach(app)
    if not app:isHidden() and not totHasFocus(app) then
      hideTot("unfocused at setup")
    end
  end
end

return M
