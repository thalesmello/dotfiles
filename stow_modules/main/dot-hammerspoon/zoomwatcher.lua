local util = require("util")

-- Offers to quit Zoom when a call ends.
--
-- Zoom keeps (and tends to raise) its main window after a call ends, which is
-- exactly the window that gets in the way. There's no "meeting ended"
-- notification, so we track the meeting window itself: while a call is running
-- Zoom has a window titled "Zoom Meeting" -- the same title hyperShift+w's
-- `wm-preset alternate-window --title "Zoom Meeting"` targets -- or "Zoom
-- Webinar" for webinars. When that window is destroyed (or renamed away), the
-- call is over.
--
-- Everything here is event-driven, via two layers of watchers:
--
--   * hs.application.watcher   -- Zoom launching/terminating, so we attach and
--                                 tear down the accessibility watchers at the
--                                 right times and never hold a dead app.
--   * hs.uielement.watcher     -- on the Zoom application: windowCreated; and on
--                                 each Zoom window: titleChanged /
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
local KILL_TIMEOUT = 5 -- seconds to wait for a graceful quit before force killing

-- Live watcher state. Kept in module-locals (and mirrored to _G) so the
-- userdata isn't garbage collected while it's still meant to be listening.
local appWatcher      -- hs.application.watcher
local zoomWatcher     -- hs.uielement.watcher on the Zoom application
local windowWatchers  -- [window id] = hs.uielement.watcher
local settleTimer     -- pending one-shot hs.timer.doAfter
local inMeeting = false
local prompting = false

local function zoomApp()
  return hs.application.get(BUNDLE)
end

-- The main/idle window is "Zoom Workplace"; a live call adds "Zoom Meeting"
-- ("Zoom Webinar" for webinars). Anchored so "Zoom Workplace" cannot match.
local function isMeetingTitle(title)
  title = title or ""
  return title:match("^Zoom Meeting") ~= nil or title:match("^Zoom Webinar") ~= nil
end

-- Does a meeting window exist right now? Only ever called from an event
-- callback, never on a schedule.
local function meetingWindowOpen()
  local app = zoomApp()
  if not app then return false end
  local found = false
  for _, w in ipairs(app:allWindows()) do
    if M.debug then util.log("zoomwatcher: window title=" .. string.format("%q", w:title() or "")) end
    if isMeetingTitle(w:title()) then found = true end
  end
  return found
end

local function quitZoom()
  local app = zoomApp()
  if not app then return end
  util.log("zoomwatcher: quitting Zoom")
  app:kill()
  hs.timer.doAfter(KILL_TIMEOUT, function()
    local still = zoomApp()
    if still then
      util.log("zoomwatcher: Zoom ignored the quit, force killing")
      still:kill9()
    end
  end)
end

-- blockAlert blocks the Lua state, so guard against a second prompt stacking up
-- behind the first, and hs.focus() so the dialog lands in front of whatever Zoom
-- just raised.
local function promptQuit()
  if prompting then return end
  prompting = true
  hs.focus()
  local button = hs.dialog.blockAlert("Zoom call ended", "Quit Zoom?", "Quit", "Keep Open")
  prompting = false
  if button == "Quit" then quitZoom() end
end

local function cancelSettle()
  if settleTimer then
    settleTimer:stop()
    settleTimer = nil
  end
end

-- Called whenever a window event might have changed meeting state.
local function refresh()
  local open = meetingWindowOpen()

  if open then
    cancelSettle()
    inMeeting = true
    return
  end

  if not inMeeting or settleTimer then return end

  settleTimer = hs.timer.doAfter(SETTLE, function()
    settleTimer = nil
    -- Came back (reconnect / transient window churn): still in the call.
    if meetingWindowOpen() then return end

    inMeeting = false

    -- Zoom may have quit on its own ("leave and quit"): nothing to ask.
    if not zoomApp() then
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
  local id = win:id()
  if not id or windowWatchers[id] then return end

  local watcher = win:newWatcher(function(_, event)
    if event == hs.uielement.watcher.elementDestroyed then
      windowWatchers[id] = nil
    end
    refresh()
  end)
  if not watcher then return end

  windowWatchers[id] = watcher
  watcher:start({
    hs.uielement.watcher.titleChanged,
    hs.uielement.watcher.elementDestroyed,
  })
end

local function detach()
  cancelSettle()
  if zoomWatcher then
    zoomWatcher:stop()
    zoomWatcher = nil
  end
  for _, w in pairs(windowWatchers or {}) do w:stop() end
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

  zoomWatcher = app:newWatcher(function(element, event)
    if event == hs.uielement.watcher.windowCreated then
      watchWindow(element)
    end
    refresh()
  end)
  if not zoomWatcher then
    util.log("zoomwatcher: could not create AX watcher for Zoom (accessibility permission?)")
    return
  end

  zoomWatcher:start({ hs.uielement.watcher.windowCreated })
  _G.ZoomWatcher.app = zoomWatcher

  -- Windows that already exist get watchers too: at setup (or if Zoom was
  -- launched before Hammerspoon reloaded) windowCreated has already fired.
  for _, w in ipairs(app:allWindows()) do watchWindow(w) end
  refresh()
end

function M.setup()
  _G.ZoomWatcher = _G.ZoomWatcher or {}
  windowWatchers = {}

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

  -- Zoom may already be running when Hammerspoon starts/reloads.
  attach(zoomApp())
end

-- Exposed so a keybinding/palette entry can quit Zoom on demand.
M.quitZoom = quitZoom

return M
