-- Back/forward history across focused windows AND Chrome tabs -- a jumplist for
-- the desktop. hyper+o walks back, hyper+i walks forward; focusing something new
-- truncates the forward branch, exactly like browser history. Entries are unique:
-- re-focusing a window/tab already in the history moves it to the top rather than
-- adding a second copy.
--
-- Detection is fully event-driven. Deliberately NOT hs.window.filter: it
-- AX-sweeps every window of every app at construction (~6.3s of a ~6.4s config
-- load, see mode.lua) and keeps per-window observers alive forever. We use the
-- same underlying primitive it does -- an AXObserver on the *application*
-- element (window_filter.lua:1434) -- minus the enumeration:
--
--   * hs.application.watcher (an NSWorkspace notification, free) for app
--     activation, which also lazily attaches...
--   * ...one hs.uielement.watcher per app for focusedWindowChanged /
--     windowCreated, giving window-to-window switches inside an app;
--   * one hs.uielement.watcher on the focused *Chrome* window for titleChanged.
--     titleChanged only fires on the window element, not the app element
--     (window_filter.lua:1411 vs :1434), so this one is re-pointed as the
--     focused Chrome window changes. Exactly one exists at a time -- other apps
--     get none, since a terminal retitles constantly and its window identity
--     never depends on its title.
--
-- A Chrome title change means "maybe a different tab", not "definitely": we
-- resolve the actual tab id through `chrome-preset active-tab-json` and only
-- push when the id differs, so navigating within a tab refreshes the existing
-- entry instead of appending.

local shell = require("shell")
local util = require("util")
local Preset = require("preset")

local uiwatcher = hs.uielement.watcher

local M = {}

local MAX = 20
local SETTINGS_KEY = "focushistory"
local CHROME_BUNDLE = "com.google.Chrome"
-- Chrome browser windows carry "- Google Chrome -" in their AX title; app-mode
-- windows (chrome-preset create-app: gchat, metamate, Calendar...) don't. Same
-- heuristic as `is-browser-window` in bin/chrome-preset. App-mode windows hold a
-- single tab, so they are recorded as plain windows -- no Chrome query needed.
local CHROME_BROWSER_MARK = "- Google Chrome -"
-- Re-query delay after a coalesced burst of title changes. A page load retitles
-- several times a second; without this each frame would spawn an osascript.
local CHROME_REQUERY_DELAY = 0.12
-- How long a hotkey press will wait for an in-flight Chrome query before acting
-- on the history as it stands. Keeps the keypress responsive.
local SETTLE_TIMEOUT = 0.3
-- Position readout duration. Shorter than Preset.displayMessage's 0.75s default:
-- this is glanced at mid-navigation, not read.
local HUD_DURATION = 0.4

-- Apps whose windows must never enter the history. Hammerspoon matters most:
-- the command palette and the herdr confirmation dialog both call hs.focus(),
-- and recording them would truncate the forward branch on every palette open.
local IGNORED_APPS = {
  ["Hammerspoon"] = true,
  ["Alfred"] = true,
  ["loginwindow"] = true,
  ["Mission Control"] = true,
  ["Window Server"] = true,
}

---------------------------------------------------------------
-- State
---------------------------------------------------------------

-- stack is oldest -> newest; cursor indexes the entry we are currently "on".
-- Entries are:
--   {kind = "window",     id = <CGWindowID>, app, title}
--   {kind = "chrome_tab", id = <tab id>, chromeWindowId = <Chrome window id>,
--    app, title, url}
-- Ids are strings, like arglist.lua. Note chromeWindowId is Chrome's own window
-- id, NOT a CGWindowID -- the two id spaces are unrelated. We never need to map
-- between them because `chrome-preset focus-tab <tab> <chromeWindow>` selects
-- the tab and raises its window in one call.
local st = _G._FocusHistory
if not st then
  st = {
    stack = {}, cursor = 0,
    busy = false, pendingDelta = nil,
    seq = 0,              -- bumped when the focused window changes; discards
                          -- Chrome results that arrive after we moved on
    lastWinId = nil,
    chromeInFlight = false, chromeDirty = false,
  }
  _G._FocusHistory = st
end

---------------------------------------------------------------
-- Helpers
---------------------------------------------------------------

local function entryKey(e) return e.kind .. ":" .. e.id end

local function shortApp(name)
  if name == "Google Chrome" then return "Chrome" end
  return name or "?"
end

local function truncate(s, n)
  s = s or ""
  if #s <= n then return s end
  return s:sub(1, n - 1) .. "…"
end

local function label(e)
  return shortApp(e.app) .. " — " .. truncate(e.title, 48)
end

-- Deliberately not Preset.displayMessage: this HUD fires on every step of a
-- rapid back/forward walk, and hs.alert stacks concurrent alerts vertically,
-- each living out its own duration. Dismissing the previous one keeps a burst of
-- presses looking like a single HUD that updates in place.
local function hud(message)
  if _G._FocusHistoryAlert then
    hs.alert.closeSpecific(_G._FocusHistoryAlert, 0)
  end
  _G._FocusHistoryAlert = hs.alert.show(message, {
    textStyle = { paragraphStyle = { alignment = "center" } },
  }, HUD_DURATION)
end

-- hs.reload() rebuilds the Lua state, and filewatcher.lua reloads on every
-- config edit, so _G alone would drop the history constantly. hs.settings is
-- backed by the user defaults plist; the payload is at most 20 small tables.
local function save()
  hs.settings.set(SETTINGS_KEY, {stack = st.stack, cursor = st.cursor})
end

local function restore()
  if #st.stack > 0 then return end
  local saved = hs.settings.get(SETTINGS_KEY)
  if type(saved) ~= "table" or type(saved.stack) ~= "table" then return end
  for _, e in ipairs(saved.stack) do
    if type(e) == "table" and e.kind and e.id then
      st.stack[#st.stack + 1] = e
    end
  end
  local cursor = tonumber(saved.cursor) or #st.stack
  st.cursor = math.max(0, math.min(math.floor(cursor), #st.stack))
end

---------------------------------------------------------------
-- Recording
---------------------------------------------------------------

-- The whole history policy lives here: refresh-in-place when we are already on
-- this thing (which is what makes in-tab Chrome navigation a no-op), otherwise
-- drop the forward branch, move-to-top any earlier sighting of the same place,
-- append, and trim to MAX from the front.
--
-- The comparison is against live state at call time, which is why the async
-- Chrome lookup below cannot corrupt it.
local function record(entry)
  if not entry then return "ignored" end

  local key = entryKey(entry)

  local cur = st.stack[st.cursor]
  if cur and entryKey(cur) == key then
    cur.title = entry.title or cur.title
    cur.url = entry.url or cur.url
    cur.app = entry.app or cur.app
    save()
    return "refreshed"
  end

  local prevCursor, dropped = st.cursor, math.max(0, #st.stack - st.cursor)
  for i = #st.stack, st.cursor + 1, -1 do st.stack[i] = nil end

  -- The same window/tab focused again is the same place, not a new one: pull the
  -- old sighting out and let it re-enter at the top. Leaving both would spend
  -- two of the 20 slots on one window and make a back/forward walk pass through
  -- it twice. Note this only ever fires on an organic focus change -- landing on
  -- an entry via back/forward matches stack[cursor] and returns above, so
  -- navigating never reorders the history under itself.
  local moved = false
  for i = #st.stack, 1, -1 do
    if entryKey(st.stack[i]) == key then
      -- Keep whatever the fresh observation couldn't supply.
      entry.title = entry.title or st.stack[i].title
      entry.url = entry.url or st.stack[i].url
      table.remove(st.stack, i)
      moved = true
    end
  end

  st.stack[#st.stack + 1] = entry
  while #st.stack > MAX do table.remove(st.stack, 1) end
  st.cursor = #st.stack
  save()

  -- Every unexpected cursor jump comes through here: a push/move resets the
  -- cursor to the top and drops the forward branch, so if back/forward seems to
  -- hit a floor, this is what to watch. Enable with
  --   hs -c 'require("focushistory").debug = true'
  if M.debug then
    print(string.format("[focushistory] %s %s  cursor=%d/%d  (was %d, dropped %d forward)",
      moved and "moved" or "pushed", key, st.cursor, #st.stack, prevCursor, dropped))
  end

  return moved and "moved" or "pushed"
end

local function isChromeBrowserTitle(title)
  return (title or ""):find(CHROME_BROWSER_MARK, 1, true) ~= nil
end

-- What is focused right now, as a plain window entry -- or nil when it must not
-- be recorded at all. Returns entry, win, appName.
local function currentWindowEntry()
  -- The iTerm hotkey window and the Ghostty quick terminal run manage=off, so
  -- yabai refuses to focus them by id (preset.lua) and an entry for them would
  -- be unrestorable. They have their own toggle (hyper+/).
  if Preset.isFloatingTerminal() then return nil end

  local win = hs.window.focusedWindow()
  if not win then return nil end
  local id = win:id()
  if not id then return nil end

  local app = win:application()
  local appName = app and app:name() or ""
  if IGNORED_APPS[appName] then return nil end

  return {
    kind = "window",
    id = tostring(id),
    app = appName,
    title = win:title() or "",
  }, win, appName
end

---------------------------------------------------------------
-- Chrome window watcher (titleChanged)
---------------------------------------------------------------

local observe   -- forward declaration; the watchers call back into it

local function unwatchChromeWindow()
  local w = _G._FocusHistoryChromeWatcher
  if w then pcall(function() w:stop() end) end
  _G._FocusHistoryChromeWatcher = nil
  _G._FocusHistoryChromeWinId = nil
end

local function watchChromeWindow(win)
  local id = win:id()
  if _G._FocusHistoryChromeWinId == id then return end
  unwatchChromeWindow()

  local ok, w = pcall(function() return win:newWatcher(function(_, event)
    if event == uiwatcher.elementDestroyed then
      unwatchChromeWindow()
      return
    end
    observe()
  end) end)
  if not ok or not w then return end

  w:start({uiwatcher.titleChanged, uiwatcher.elementDestroyed})
  _G._FocusHistoryChromeWatcher = w
  _G._FocusHistoryChromeWinId = id
end

---------------------------------------------------------------
-- Chrome tab resolution
---------------------------------------------------------------

-- `fallback` is the plain-window entry for the same Chrome window, carried only
-- so we can label the tab if Chrome hands back an empty title.
--
-- Recording NOTHING is the correct outcome for every failure here, and the
-- reason is not obvious. A Chrome browser window is represented in the history
-- as a chrome_tab entry; a `window` entry for the very same window is a
-- different key. So substituting the fallback on a bad lookup doesn't degrade
-- gracefully -- it pushes a second, competing entry for a place already at the
-- cursor, and a push truncates the forward branch. Leaving the history untouched
-- costs at most a missed update; the next title change re-queries anyway.
local function handleChromeResult(ok, out, fallback)
  -- Non-zero means Chrome isn't running (the subcommand guards on the process so
  -- it can't launch it).
  if not ok then return end

  local parsed, decoded = pcall(hs.json.decode, out)
  if not parsed then decoded = nil end
  local tabId = type(decoded) == "table" and tonumber(decoded.id) or nil
  local chromeWindowId = type(decoded) == "table" and tonumber(decoded.windowId) or nil
  if not tabId or not chromeWindowId then
    -- `{}`: --match-title found no window whose active tab matches this one, or
    -- Chrome has no scriptable window at all.
    util.log("focushistory: no matching Chrome tab for", fallback.title)
    return
  end

  local tabTitle = decoded.title or ""

  record({
    kind = "chrome_tab",
    id = string.format("%d", math.floor(tabId)),
    chromeWindowId = string.format("%d", math.floor(chromeWindowId)),
    -- The CGWindowID of the macOS window hosting the tab. Not used to focus
    -- (chrome-preset focus-tab needs Chrome's own window id) -- it exists so the
    -- jump can confirm the tab actually came forward. Goes stale if the tab is
    -- later dragged to another window, which verifyLanded tolerates.
    cgWindowId = fallback.id,
    app = "Google Chrome",
    title = tabTitle ~= "" and tabTitle or fallback.title,
    url = decoded.url or "",
  })
end

-- At most one query in flight. A trigger arriving during one sets chromeDirty,
-- which schedules exactly one re-observation when it lands (not a queue).
local function queryChromeTab(fallback, done)
  if st.chromeInFlight then
    st.chromeDirty = true
    return done()
  end

  st.chromeInFlight = true
  local mySeq = st.seq

  -- --match-title pins the lookup to *this* macOS window. Chrome's own window
  -- order counts app-mode windows, so without it we'd frequently get some other
  -- window's tab and push a bogus entry.
  local args = {"chrome-preset", "active-tab-json",
                "--match-title=" .. (fallback.title or ""), print_stdout = false}

  shell.task(args, function(ok, out)
    st.chromeInFlight = false
    local dirty = st.chromeDirty
    st.chromeDirty = false

    -- Focus moved to a different window while we were asking: the answer is
    -- about a window we already left.
    if st.seq == mySeq and not st.busy then
      handleChromeResult(ok, out, fallback)
    end

    if dirty then hs.timer.doAfter(CHROME_REQUERY_DELAY, function() observe() end) end
    done()
  end)
end

---------------------------------------------------------------
-- Observation
---------------------------------------------------------------

-- Record whatever is focused now. `done` (optional) fires once the entry has
-- actually been recorded, which for Chrome is after the async tab lookup.
observe = function(done)
  done = done or function() end
  -- While navigating, the cursor is already where it needs to be; an event for
  -- the window we are leaving would push a bogus entry and truncate the branch.
  if st.busy then return done() end

  local entry, win, appName = currentWindowEntry()
  if not entry then return done() end

  -- Still settling from a jump (see finish()): keep the watchers pointed at the
  -- right window, but don't let this observation touch the history.
  if st.settleUntil and hs.timer.secondsSinceEpoch() < st.settleUntil then
    if appName == "Google Chrome" and isChromeBrowserTitle(entry.title) then
      watchChromeWindow(win)
    end
    return done()
  end

  if entry.id ~= st.lastWinId then
    st.seq = st.seq + 1
    st.lastWinId = entry.id
  end

  if appName == "Google Chrome" and isChromeBrowserTitle(entry.title) then
    watchChromeWindow(win)
    -- The query owns the record for this window: pushing a plain window entry
    -- here too would leave a duplicate the tab entry can't dedupe against.
    queryChromeTab(entry, done)
    return
  end

  unwatchChromeWindow()
  record(entry)
  done()
end

---------------------------------------------------------------
-- Focusing an entry
---------------------------------------------------------------

-- Has focus actually arrived at `entry`? Both backends report success before
-- macOS has made the window key -- yabai returns as soon as it has asked, and
-- Chrome's `activate()` is asynchronous -- so the caller must not declare the
-- jump finished until this says so. Getting this wrong is not cosmetic: while
-- the jump is in flight st.busy suppresses recording, so clearing it early lets
-- the focus event for the window we are LEAVING land in the history, where it
-- doesn't match the cursor, gets pushed, and truncates the forward branch.
--
-- Same 20ms/20-try shape as smartcmdtab.lua.
local function verifyLanded(entry, cb, tries)
  tries = tries or 0
  local win = hs.window.focusedWindow()
  if win then
    if entry.kind == "chrome_tab" then
      -- Prefer the recorded host window, but a tab dragged to another window
      -- (or restored from settings before cgWindowId existed) still counts as
      -- landed once Chrome owns the focused window.
      local app = win:application()
      local title = win:title() or ""
      -- Waiting for the TITLE, not just for Chrome to come forward, is the
      -- whole point. Selecting a tab updates the AX window title asynchronously,
      -- and observe() feeds that title to --match-title to identify the tab. Act
      -- on a stale title and the lookup faithfully resolves the window that
      -- still has the OLD tab active -- a different tab id, so record() pushes
      -- instead of refreshing, drops the forward branch, and pins the cursor one
      -- step above wherever we just landed. That is the "can't go back past N"
      -- floor: cursor oscillates between N and N+1 forever.
      if (app and app:name()) == "Google Chrome"
        and (not entry.cgWindowId or tostring(win:id()) == entry.cgWindowId)
        and (not entry.title or entry.title == "" or title:sub(1, #entry.title) == entry.title) then
        return cb(true)
      end
    elseif tostring(win:id()) == entry.id then
      return cb(true)
    end
  end
  if tries >= 20 then return cb(false) end
  hs.timer.doAfter(0.02, function() verifyLanded(entry, cb, tries + 1) end)
end

local function focusEntry(entry, cb)
  if entry.kind == "chrome_tab" then
    -- A JXA `Application("Google Chrome")` reference LAUNCHES Chrome, so never
    -- reach for a tab when Chrome is gone. applicationsForBundleID is a plain
    -- NSRunningApplication lookup -- no AX, ~0.02ms.
    if #hs.application.applicationsForBundleID(CHROME_BUNDLE) == 0 then return cb(false) end
    -- Exits non-zero when the tab has been closed, which is our liveness test.
    shell.task({"chrome-preset", "focus-tab", entry.id, entry.chromeWindowId}, function(ok)
      if not ok then return cb(false) end
      -- The tab is selected, but Chrome may not be frontmost yet. Treat a
      -- verification timeout as success anyway: the tab did exist and was
      -- selected, so dropping the entry as stale would be wrong.
      verifyLanded(entry, function() cb(true) end)
    end)
    return
  end

  shell.task({"wm-preset", "focus-window-id", entry.id}, function(ok)
    if not ok then return cb(false) end
    verifyLanded(entry, function(focused)
      if focused then return cb(true) end
      -- Only now pay for the cross-space path: it polls up to ~3s, far too slow
      -- to sit on a hotkey's happy path.
      shell.task({"wm-preset", "focus-window-id", "--wait-focus", entry.id}, cb)
    end)
  end)
end

---------------------------------------------------------------
-- Navigation
---------------------------------------------------------------

local jump

-- Focus stack[index] directly (used by the chooser as well as by back/forward).
local function jumpToIndex(index, delta)
  st.busy = true
  local watchdog = hs.timer.doAfter(4, function() st.busy = false end)

  local function finish()
    watchdog:stop()
    -- Belt and braces for the fixed point described in verifyLanded: even with
    -- verification, an event already queued from the transition can arrive just
    -- after busy clears and describe the window we left. Ignore observations for
    -- a beat -- shorter than any deliberate human app switch, and skipping one is
    -- harmless because the next real focus change records correctly.
    st.settleUntil = hs.timer.secondsSinceEpoch() + 0.15
    st.busy = false
    local pending = st.pendingDelta
    st.pendingDelta = nil
    if pending then jump(pending) end
  end

  local function step(i, tries)
    if tries > MAX then return finish() end

    local j = (delta == 0) and i or (i + delta)
    if j < 1 or j > #st.stack then
      hud(delta < 0 and "history start" or "history end")
      return finish()
    end

    local target = st.stack[j]
    -- Set the cursor BEFORE focusing: when the resulting focus event arrives,
    -- record() then sees a matching key and refreshes instead of pushing. That
    -- is the whole suppression mechanism -- no "am I navigating" flag needed on
    -- the landing event.
    st.cursor = j
    focusEntry(target, function(ok)
      if ok then
        save()
        -- The arrow points the way you travelled, so it leads on the way back
        -- and trails on the way forward: "◀ 3/7" vs "3/7 ▶".
        local position = string.format("%d/%d", st.cursor, #st.stack)
        hud((delta < 0 and ("◀ " .. position) or (position .. " ▶")) .. "\n" .. label(target))
        return finish()
      end

      -- Gone. Drop it and keep walking the same direction.
      if M.debug then
        print(string.format("[focushistory] stale, dropping %s (%s) at %d/%d",
          entryKey(target), target.title or "", j, #st.stack))
      end
      table.remove(st.stack, j)
      -- Going back, the removed slot was below the cursor so everything above
      -- shifted down and the current entry now sits at j. Going forward, the
      -- next candidate slid into slot j, so resume from j - 1.
      local resumeAt = (delta < 0) and j or (j - 1)
      st.cursor = math.max(0, resumeAt)
      save()
      if delta == 0 then return finish() end
      step(st.cursor, tries + 1)
    end)
  end

  step(index, 1)
end

jump = function(delta)
  if st.busy then
    -- Coalesce key-repeat into at most one queued step.
    st.pendingDelta = delta
    return
  end

  if #st.stack == 0 then
    hud("Focus history: empty")
    return
  end

  -- Bring the history up to date first. Focus may have moved via an app that
  -- posts no AX notification, or a Chrome tab lookup may still be pending; this
  -- makes the hotkey self-healing rather than dependent on perfect event
  -- coverage.
  local started = false
  local function go()
    if started then return end
    started = true
    jumpToIndex(st.cursor, delta)
  end
  observe(go)
  hs.timer.doAfter(SETTLE_TIMEOUT, go)
end

function M.back() jump(-1) end
function M.forward() jump(1) end

---------------------------------------------------------------
-- Palette helpers
---------------------------------------------------------------

function M.clear()
  st.stack = {}
  st.cursor = 0
  save()
  hud("Focus history cleared")
end

function M.showList()
  local choices = {}
  -- Newest first, the way a jumplist reads.
  for i = #st.stack, 1, -1 do
    local e = st.stack[i]
    choices[#choices + 1] = {
      text = (i == st.cursor and "▸ " or "  ") .. label(e),
      subText = e.url and e.url ~= "" and e.url or shortApp(e.app),
      index = i,
    }
  end
  local chooser = hs.chooser.new(function(choice)
    if choice then jumpToIndex(choice.index, 0) end
  end)
  chooser:choices(choices)
  chooser:show()
end

-- For `hs -c 'hs.inspect(require("focushistory").dump())'`.
function M.dump()
  return {cursor = st.cursor, entries = st.stack}
end

---------------------------------------------------------------
-- Setup
---------------------------------------------------------------

local function attachAppWatcher(app)
  if not app then return end
  local pid = app:pid()
  if not pid or _G._FocusHistoryAppWatchers[pid] then return end
  if IGNORED_APPS[app:name() or ""] then return end
  -- Skip pure background processes: no UI means no focusable window. Same test
  -- hs.window.filter uses (window_filter.lua's startAppWatcher).
  if (app:kind() or 0) < 0 then return end

  local ok, w = pcall(function() return app:newWatcher(function() observe() end, pid) end)
  if not ok or not w then return end

  -- focusedWindowChanged also fires for background apps; observe() reads the
  -- real focused window, so those just dedupe into a refresh.
  w:start({uiwatcher.focusedWindowChanged, uiwatcher.windowCreated})
  _G._FocusHistoryAppWatchers[pid] = w
end

function M.setup()
  -- Reloads must not leave the old observers running (see the same pattern for
  -- the herdr pasteboard watcher in keybindings.lua).
  if _G._FocusHistoryAppWatcher then
    pcall(function() _G._FocusHistoryAppWatcher:stop() end)
  end
  for _, w in pairs(_G._FocusHistoryAppWatchers or {}) do
    pcall(function() w:stop() end)
  end
  _G._FocusHistoryAppWatchers = {}
  unwatchChromeWindow()

  restore()

  _G._FocusHistoryAppWatcher = hs.application.watcher.new(function(_, event, app)
    if event == hs.application.watcher.activated then
      attachAppWatcher(app)
      -- NSWorkspace posts activation before AX focus settles, so reading the
      -- focused window right now can still report the app we just left -- which
      -- would push a bogus entry. Let it settle; focusedWindowChanged from the
      -- per-app watcher is immediate and needs no such delay.
      hs.timer.doAfter(0.05, function() observe() end)
    elseif event == hs.application.watcher.terminated then
      local pid = app and app:pid()
      if pid and _G._FocusHistoryAppWatchers[pid] then
        pcall(function() _G._FocusHistoryAppWatchers[pid]:stop() end)
        _G._FocusHistoryAppWatchers[pid] = nil
      end
    end
  end)
  _G._FocusHistoryAppWatcher:start()

  -- Seed from whatever is focused at load time.
  attachAppWatcher(hs.application.frontmostApplication())
  observe()
end

return M
