local util = require("util")

-- Closes Zoom after a cancellable countdown when a call ends.
--
-- Zoom keeps (and tends to raise) its main window after a call ends, which is
-- exactly the window that gets in the way. There's no "meeting ended"
-- notification, so we track the meeting window and Zoom's in-meeting menu bar:
--   * While a call is in its normal view, Zoom has a window titled "Zoom
--     Meeting" -- the same title hyperShift+w's
--     `wm-preset alternate-window --title "Zoom Meeting"` targets -- or "Zoom
--     Webinar" for webinars.
--   * When switching to minimal view (cmd+shift+m) or sharing the screen, Zoom
--     orders out the "Zoom Meeting" window and replaces it with untitled
--     AXSystemDialog panels, but keeps the top-level "Meeting" menu in the menu
--     bar for the duration of the call (removed on dealloc when the session
--     ends).
--
-- Everything here is event-driven, via two layers of watchers:
--
--   * hs.application.watcher   -- Zoom launching/terminating, so we attach and
--                                 tear down the accessibility watchers at the
--                                 right times and never hold a dead app.
--   * hs.uielement.watcher     -- on the Zoom application: windowCreated /
--                                 focusedWindowChanged / mainWindowChanged; and
--                                 on each Zoom window: titleChanged /
--                                 elementDestroyed.
--
-- hs.window.filter is deliberately not used: Zoom's meeting window is a
-- borderless oddball that the default filters treat as non-standard, so its
-- create/destroy events never arrive. Raw AX watchers see it.
local M = {}

-- Set true to log every Zoom window title on each event -- useful for
-- confirming what this Zoom version actually calls its live-meeting window.
M.debug = false

-- Identify Zoom by bundle ID, NOT by name: "zoom.us" is only the executable
-- name (what `pgrep -x zoom.us` elsewhere in this config matches). The app name
-- macOS/Hammerspoon report is "Zoom", so hs.application.get("zoom.us") returns
-- nil and nothing ever attaches. hs.application.get accepts a bundle ID.
local BUNDLE = "us.zoom.xos"
-- Delay between the meeting window disappearing and the prompt. Zoom flickers
-- windows mid-call (reconnects, screen-share handoff, view switches), so give it
-- a moment and re-check before concluding the call really ended.
local SETTLE = 2
local COUNTDOWN = 5
local KILL_TIMEOUT = 5 -- seconds to wait for a graceful quit before force killing

-- Live watcher state. Kept in module-locals (and mirrored to _G) so the
-- userdata isn't garbage collected while it's still meant to be listening.
local appWatcher      -- hs.application.watcher
local zoomWatcher     -- hs.uielement.watcher on the Zoom application
local windowWatchers  -- [window id] = hs.uielement.watcher
local settleTimer     -- pending one-shot hs.timer.doAfter
local inMeeting = false
local prompt -- non-blocking countdown UI and timer

local function zoomApp()
  local apps = hs.application.applicationsForBundleID(BUNDLE)
  return apps and apps[1] or nil
end

-- The main/idle window is "Zoom Workplace"; a live call adds "Zoom Meeting"
-- ("Zoom Webinar" for webinars). Anchored so "Zoom Workplace" cannot match.
local function isMeetingTitle(title)
  title = title or ""
  return title:match("^Zoom Meeting") ~= nil or title:match("^Zoom Webinar") ~= nil
end

-- Does a meeting window exist right now? Checked on events and while a
-- pending close countdown needs to guard against a new meeting.
local function meetingWindowOpen(app)
  app = app or zoomApp()
  if not app then return false end
  local found = false
  for _, w in ipairs(app:allWindows()) do
    if M.debug then util.log("zoomwatcher: window title=" .. string.format("%q", w:title() or "")) end
    if isMeetingTitle(w:title()) then found = true end
  end
  return found
end

-- While a call is active (including minimal view via cmd+shift+m and screen
-- sharing, where Zoom orders out the "Zoom Meeting" window and replaces it with
-- untitled AXSystemDialog panels), Zoom's ZMMeetingViewMenuMgr keeps a top-level
-- "Meeting" menu in the menu bar and removes it when the call ends.
local function meetingMenuPresent(app)
  app = app or zoomApp()
  if not app then return false end
  local axApp = hs.axuielement.applicationElement(app)
  local menuBar = axApp and axApp:attributeValue("AXMenuBar")
  for _, item in ipairs(menuBar and menuBar:attributeValue("AXChildren") or {}) do
    if item:attributeValue("AXTitle") == "Meeting" then
      if M.debug then util.log("zoomwatcher: Meeting menu present") end
      return true
    end
  end
  return false
end

local function quitZoom()
  local app = zoomApp()
  if not app then return end
  util.log("zoomwatcher: quitting Zoom")
  app:kill()
  hs.timer.doAfter(KILL_TIMEOUT, function()
    local still = zoomApp()
    if still and still:pid() == app:pid()
      and not meetingWindowOpen(still) and not meetingMenuPresent(still) then
      util.log("zoomwatcher: Zoom ignored the quit, force killing")
      still:kill9()
    end
  end)
end

-- Match HoldToQuit's progress-ring HUD without stealing application focus.
local function cancelPrompt()
  local old = prompt
  prompt = nil
  if not old then return end
  _G.ZoomWatcher.quitPending = nil
  for _, timer in ipairs(old.timers) do timer:stop() end
  for _, hotkey in ipairs(old.hotkeys) do hotkey:delete() end
  if old.hud then old.hud:delete() end
end

local function promptQuit()
  if prompt then return end
  local app = zoomApp()
  if not app then return end
  local state = {pid = app:pid(), timers = {}, hotkeys = {}}
  prompt = state
  _G.ZoomWatcher.cancelPrompt = cancelPrompt

  local function finish(confirmed)
    if prompt ~= state then return end
    cancelPrompt()
    local current = zoomApp()
    -- Never close a replacement process or a newly started meeting.
    if confirmed and current and current:pid() == state.pid
      and not meetingWindowOpen(current) and not meetingMenuPresent(current) then
      quitZoom()
    end
  end

  -- HoldToQuit dispatches here before starting its usual one-second hold.
  -- It still owns the physical key press, preventing repeats from quitting
  -- whichever application is frontmost after Zoom disappears.
  _G.ZoomWatcher.quitPending = function()
    if prompt ~= state then return false end
    finish(true)
    return true
  end
  for _, key in ipairs({"return", "padenter", "escape"}) do
    state.hotkeys[#state.hotkeys + 1] = hs.hotkey.bind({}, key, function() finish(false) end)
  end

  -- Reuse the exact HUD drawing/style, but keep a separate canvas and timers
  -- so the countdown doesn't alter HoldToQuit's own hold state.
  state.hud = spoon.HoldToQuit:_newHUD(app)
  state.hud:elementAttribute(6, "text", "Zoom call ended")
  state.hud:elementAttribute(5, "text", "5")
  state.hud:elementAttribute(7, "text", "Closing in 5.0s · ⌘Q to quit now")
  state.hud:appendElements({
    type = "rectangle", action = "fill", id = "cancel",
    frame = {x = 100, y = 204, w = 160, h = 32},
    roundedRectRadii = {xRadius = 8, yRadius = 8},
    fillColor = {red = 0.25, green = 0.62, blue = 1, alpha = 0.96},
    trackMouseUp = true,
  }, {
    type = "text", action = "fill", id = "cancelLabel",
    frame = {x = 100, y = 208, w = 160, h = 24},
    text = "Cancel (↩)", textSize = 14, textAlignment = "center",
    textColor = {white = 1}, trackMouseUp = true,
  })
  local frame = state.hud:frame()
  frame.y = frame.y - 16
  frame.h = 252
  state.hud:frame(frame)
  state.hud:elementAttribute(1, "frame", {x = 0, y = 0, w = 360, h = 252})
  state.hud:mouseCallback(function(_, event, id)
    if event == "mouseUp" and (id == "cancel" or id == "cancelLabel") then finish(false) end
  end)

  local startedAt = hs.timer.absoluteTime()
  local lastSecond = -1
  local function tick()
    if prompt ~= state then return end
    local elapsed = (hs.timer.absoluteTime() - startedAt) / 1e9
    -- AX checks only once a second; redraw the ring smoothly at 30 Hz.
    local second = math.floor(elapsed)
    if second ~= lastSecond then
      lastSecond = second
      local current = zoomApp()
      if not current or current:pid() ~= state.pid
        or meetingWindowOpen(current) or meetingMenuPresent(current) then
        finish(false)
        return
      end
    end
    local remaining = math.max(0, COUNTDOWN - elapsed)
    local progress = math.min(1, elapsed / COUNTDOWN)
    state.hud:elementAttribute(3, "endAngle", -90 + math.min(359.9, progress * 360))
    state.hud:elementAttribute(5, "text", tostring(math.ceil(remaining)))
    state.hud:elementAttribute(7, "text", string.format("Closing in %.1fs · ⌘Q to quit now", remaining))
  end
  state.timers[1] = hs.timer.doAfter(COUNTDOWN, function() finish(true) end)
  state.timers[2] = hs.timer.doEvery(1 / 30, tick)
  tick()
end

local function cancelSettle()
  if settleTimer then
    settleTimer:stop()
    settleTimer = nil
  end
end

local watchAllWindows

-- Called whenever a window event might have changed meeting state.
local function refresh()
  local app = zoomApp()
  watchAllWindows(app)

  if meetingWindowOpen(app) then
    cancelSettle()
    cancelPrompt()
    inMeeting = true
    return
  end

  if not inMeeting then
    if meetingMenuPresent(app) then
      cancelPrompt()
      inMeeting = true
    end
    return
  end

  cancelSettle()
  settleTimer = hs.timer.doAfter(SETTLE, function()
    settleTimer = nil
    local curApp = zoomApp()
    watchAllWindows(curApp)

    -- Came back (reconnect / transient window churn) or still in the call with
    -- the main meeting window ordered out (minimal view via cmd+shift+m, or
    -- screen sharing): keep armed and do not prompt.
    if meetingWindowOpen(curApp) or meetingMenuPresent(curApp) then return end

    inMeeting = false

    -- Zoom may have quit on its own ("leave and quit"): nothing to ask.
    if not curApp then
      util.log("zoomwatcher: meeting ended, Zoom already gone")
      return
    end

    util.log("zoomwatcher: meeting ended, prompting to quit")
    promptQuit()
  end)
end

-- Watch one Zoom window for renames and destruction. Zoom both creates a
-- dedicated meeting window and renames existing ones, so every window gets a
-- watcher, not just the ones that look like a meeting at creation time.
local function watchWindow(win)
  local id = win and win:id()
  if not id or windowWatchers[id] then return end

  local ok, watcher = pcall(function()
    return win:newWatcher(function(_, event)
      if event == hs.uielement.watcher.elementDestroyed then
        windowWatchers[id] = nil
      end
      refresh()
    end)
  end)
  if not ok or not watcher then return end

  windowWatchers[id] = watcher
  watcher:start({
    hs.uielement.watcher.titleChanged,
    hs.uielement.watcher.elementDestroyed,
  })
end

watchAllWindows = function(app)
  app = app or zoomApp()
  if not app then return end
  for _, w in ipairs(app:allWindows()) do watchWindow(w) end
end

local function detach()
  cancelSettle()
  cancelPrompt()
  if zoomWatcher then
    pcall(function() zoomWatcher:stop() end)
    zoomWatcher = nil
  end
  for _, w in pairs(windowWatchers or {}) do
    pcall(function() w:stop() end)
  end
  windowWatchers = {}
  inMeeting = false
  _G.ZoomWatcher.app = nil
  _G.ZoomWatcher.windows = windowWatchers
end

local function attach(app)
  detach()
  if not app then
    util.log("zoomwatcher: Zoom not running, nothing to attach")
    return
  end
  util.log("zoomwatcher: attaching to " .. (app:name() or "?") .. " (" .. (app:bundleID() or "?") .. ")")

  local ok, watcher = pcall(function()
    return app:newWatcher(function(element, event)
      if event == hs.uielement.watcher.windowCreated then
        watchWindow(element)
      end
      refresh()
    end)
  end)
  if not ok or not watcher then
    util.log("zoomwatcher: could not create AX watcher for Zoom (accessibility permission?)")
    return
  end

  zoomWatcher = watcher
  zoomWatcher:start({
    hs.uielement.watcher.windowCreated,
    hs.uielement.watcher.focusedWindowChanged,
    hs.uielement.watcher.mainWindowChanged,
  })
  _G.ZoomWatcher.app = zoomWatcher

  -- Windows that already exist get watchers too: at setup (or if Zoom was
  -- launched before Hammerspoon reloaded) windowCreated has already fired.
  watchAllWindows(app)
  refresh()
end

function M.setup()
  if _G.ZoomWatcher then
    if _G.ZoomWatcher.cancelPrompt then _G.ZoomWatcher.cancelPrompt() end
    if _G.ZoomWatcher.bootstrap then _G.ZoomWatcher.bootstrap:stop() end
    if _G.ZoomWatcher.appWatcher then pcall(function() _G.ZoomWatcher.appWatcher:stop() end) end
    if _G.ZoomWatcher.app then pcall(function() _G.ZoomWatcher.app:stop() end) end
    for _, w in pairs(_G.ZoomWatcher.windows or {}) do pcall(function() w:stop() end) end
  end

  _G.ZoomWatcher = {}
  windowWatchers = {}
  zoomWatcher = nil
  inMeeting = false
  cancelSettle()

  appWatcher = hs.application.watcher.new(function(name, event, app)
    -- On terminated, `name` is nil, so identify Zoom by the app object instead.
    if event == hs.application.watcher.terminated then
      if zoomWatcher and app and app:pid() == zoomWatcher:pid() then
        util.log("zoomwatcher: Zoom terminated, detaching")
        detach()
      end
      return
    end

    -- Match on bundle ID, not `name`: it is "Zoom" on current versions and
    -- "zoom.us" on older ones.
    if not app or app:bundleID() ~= BUNDLE then return end

    if event == hs.application.watcher.launched then
      util.log("zoomwatcher: Zoom launched, attaching")
      attach(app)
    end
  end)
  appWatcher:start()
  _G.ZoomWatcher.appWatcher = appWatcher

  -- Keep NSWorkspace listening immediately; defer the initial AX sweep until
  -- startup has yielded. A launch event can attach sooner, so do not reset it.
  local generation = _G.ZoomWatcher
  generation.bootstrap = hs.timer.doAfter(0, function()
    if _G.ZoomWatcher ~= generation then return end
    generation.bootstrap = nil
    if not zoomWatcher then attach(zoomApp()) end
  end)
end

-- Exposed so a keybinding/palette entry can quit Zoom on demand.
M.quitZoom = quitZoom

return M
