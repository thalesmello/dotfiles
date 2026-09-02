-- Back/forward history across focused windows -- a jumplist for the desktop.
-- hyper+o walks back, hyper+i walks forward; focusing something new truncates the
-- forward branch, exactly like browser history. Entries are unique: re-focusing a
-- window already in the history moves it to the top rather than adding a copy.
--
-- Detection is event-driven. Deliberately NOT hs.window.filter: it AX-sweeps every
-- window of every app at construction (~6.3s of a ~6.4s config load, see mode.lua)
-- and keeps per-window observers alive forever. We use the same underlying
-- primitive it does -- an AXObserver on the *application* element
-- (window_filter.lua:1434) -- minus the enumeration:
--
--   * hs.application.watcher (an NSWorkspace notification, free) for app
--     activation, which also lazily attaches...
--   * ...one hs.uielement.watcher per app for focusedWindowChanged /
--     windowCreated, giving window-to-window switches inside an app.
--
-- Chrome tabs arrive from a second source: chromebridge.lua feeds in
-- chrome.tabs.onActivated events from a Chrome extension, so a tab is a place in
-- its own right. It calls M.recordDwelled(), which puts tabs behind the same
-- dwell as windows -- flicking through tabs hunting for one should leave no more
-- trace than flicking through windows.
--
-- An earlier version tried to do this without an extension, inferring tab
-- identity from the window title and correlating it back through
-- `chrome-preset active-tab-json`. Every layer of that inference turned out to be
-- wrong in some real situation -- titles that lag a tab switch, Chrome's window
-- order not matching macOS's, pages that retitle continuously -- and each
-- misidentification pushed a competing entry, which truncated the forward branch.
-- Hence the extension: the tab id now arrives with the event that caused it.

local shell = require("shell")
local Preset = require("preset")

local uiwatcher = hs.uielement.watcher

local M = {}

-- kind -> function(entry, cb). Lets another module own a kind of entry without
-- either module requiring the other: chromebridge.lua registers "chrome_tab"
-- here and in return calls M.recordDwelled() when the extension reports a tab.
-- Anything with no handler is focused as a plain macOS window.
M.focusHandlers = {}

local MAX = 20
local SETTINGS_KEY = "focushistory"
-- How long a hotkey press will wait before acting on the history as it stands.
local SETTLE_TIMEOUT = 0.3
-- Position readout duration. Shorter than Preset.displayMessage's 0.75s default:
-- this is glanced at mid-navigation, not read.
local HUD_DURATION = 0.4
-- How long a window must hold focus before it earns a history slot. See observe().
-- Hunting for a window means flicking through several, and none of those belong
-- in the history -- only wherever you come to rest. Exposed on M so it can be
-- tuned live while calibrating:
--   hs -c 'require("focushistory").dwell = 1.5'
M.dwell = 5.0

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

-- Individual windows to ignore, matched on app plus a Lua pattern against the
-- title. For windows that pass isStandard() but are not places you navigate to.
--
-- Chrome's Picture in Picture is the motivating case, and it is invisible to
-- every structural test available in-process: it reports subrole
-- AXStandardWindow, so isStandard() waves it through. What actually marks it out
-- is only visible to yabai -- level 3, layer "above", is-sticky true -- and
-- hs.window exposes no window level or sticky flag, so there is nothing cheaper
-- to key on than the title. It is a floating companion to a tab, not a
-- destination, and being sticky it follows you across Spaces and can hold focus
-- indefinitely, which with a 5s dwell is more than enough to earn a slot.
--
-- Caveat worth knowing: Chrome localises this title, so this stops matching if
-- you ever run Chrome in another language.
local IGNORED_WINDOWS = {
  {app = "Google Chrome", title = "^Picture in Picture$"},
}

---------------------------------------------------------------
-- State
---------------------------------------------------------------

-- stack is oldest -> newest; cursor indexes the entry we are currently "on".
-- Entries are {kind = "window", id = <CGWindowID>, app, title}; ids are strings,
-- like arglist.lua. `kind` is retained so the extension can add "chrome_tab"
-- entries alongside these without a migration.
local st = _G._FocusHistory
if not st then
  st = {
    stack = {}, cursor = 0,
    busy = false, pendingDelta = nil,
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

-- This HUD fires on every step of a rapid back/forward walk. Dismissing the
-- previous alert -- so a burst of presses looks like one HUD updating in place
-- rather than a stack -- is now what Preset.displayMessage does for every
-- message, so it is no longer worth a private copy of that logic.
local function hud(message)
  Preset.displayMessage(message, HUD_DURATION)
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
    -- A kind with no focus handler can't be jumped to, so it would only be dead
    -- weight for back/forward to skip past. chrome_tab entries survive only when
    -- chromebridge has registered itself (i.e. the extension route is wired up);
    -- ones left behind by the old title-inference code are dropped.
    if type(e) == "table" and e.id
      and (e.kind == "window" or M.focusHandlers[e.kind]) then
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
-- this thing, otherwise drop the forward branch, move-to-top any earlier sighting
-- of the same place, append, and trim to MAX from the front.
local function record(entry)
  if not entry then return "ignored" end

  local key = entryKey(entry)

  local cur = st.stack[st.cursor]
  if cur and entryKey(cur) == key then
    cur.title = entry.title or cur.title
    cur.app = entry.app or cur.app
    save()
    return "refreshed"
  end

  local prevCursor, dropped = st.cursor, math.max(0, #st.stack - st.cursor)
  for i = #st.stack, st.cursor + 1, -1 do st.stack[i] = nil end

  -- The same window focused again is the same place, not a new one: pull the old
  -- sighting out and let it re-enter at the top. Leaving both would spend two of
  -- the 20 slots on one window and make a back/forward walk pass through it
  -- twice. Note this only ever fires on an organic focus change -- landing on an
  -- entry via back/forward matches stack[cursor] and returns above, so navigating
  -- never reorders the history under itself.
  local moved = false
  for i = #st.stack, 1, -1 do
    if entryKey(st.stack[i]) == key then
      entry.title = entry.title or st.stack[i].title
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

-- What is focused right now, or nil when it must not be recorded at all.
local function currentWindowEntry()
  -- The iTerm hotkey window and the Ghostty quick terminal run manage=off, so
  -- yabai refuses to focus them by id (preset.lua) and an entry for them would
  -- be unrestorable. They have their own toggle (hyper+/).
  if Preset.isFloatingTerminal() then return nil end

  local win = hs.window.focusedWindow()
  if not win then return nil end
  local id = win:id()
  if not id then return nil end

  -- Only real, user-facing windows (AXStandardWindow). Sheets, alerts, panels
  -- and toolbars take focus constantly -- a fido2macos key prompt, Zoom's
  -- floating meeting controls -- and each one landing in the history is not
  -- merely clutter: recording is an organic focus change, so it truncates the
  -- forward branch. A prompt flashing past mid-navigation would wipe everything
  -- ahead of the cursor. Same test cycleTerminalWindows uses in keybindings.lua.
  if not win:isStandard() then return nil end

  local app = win:application()
  local appName = app and app:name() or ""
  if IGNORED_APPS[appName] then return nil end

  local title = win:title() or ""
  for _, rule in ipairs(IGNORED_WINDOWS) do
    if rule.app == appName and title:match(rule.title) then return nil end
  end

  -- One macOS window must never be represented under two keys. A Chrome window
  -- the extension has reported lives in the stack as chrome_tab:<tabId>; the same
  -- window seen from here would be window:<cgWindowId>. Those are different keys,
  -- so recording this would push a second entry for one place -- and a push
  -- truncates the forward branch.
  --
  -- This scans the whole stack rather than just the cursor, because the collision
  -- shows up precisely when the two sources disagree about a window that is NOT
  -- where the cursor is: the extension goes quiet (service worker asleep,
  -- Hammerspoon reloaded and the socket dropped), you navigate back onto a window
  -- recorded as a tab, and the AX observer records it afresh as a plain window.
  -- That is what wiped a whole forward branch on switching to the Metamate window.
  --
  -- Note what this does NOT require: knowing whether the extension is alive. No
  -- chrome_tab entries means nothing to collide with, so Chrome degrades to
  -- window-level tracking on its own.
  local idStr = tostring(id)
  for _, e in ipairs(st.stack) do
    if e.cgWindowId == idStr then return nil end
  end

  return {
    kind = "window",
    id = tostring(id),
    app = appName,
    title = title,
  }
end

---------------------------------------------------------------
-- Observation
---------------------------------------------------------------

local function commit(done)
  done = done or function() end
  -- While navigating, the cursor is already where it needs to be; an event for
  -- the window we are leaving would push a bogus entry and truncate the branch.
  if st.busy then return done() end

  -- Still settling from a jump (see finish()).
  if st.settleUntil and hs.timer.secondsSinceEpoch() < st.settleUntil then
    return done()
  end

  record(currentWindowEntry())
  done()
end

-- A window has to HOLD focus (M.dwell, 5s) to earn a history slot. Flick through
-- five windows hunting for the right one and none of them are recorded -- only
-- wherever you come to rest.
--
-- AX notifications fire the instant focus moves, so without this every momentary
-- window lands in the history -- Zoom's meeting controls, a fido2macos key
-- prompt, an app's startup splash. That is worse than clutter: recording is an
-- organic focus change, so each one truncates the forward branch. A prompt
-- flashing past mid-navigation wipes everything ahead of the cursor.
--
-- The debounce is keyed on the PLACE, not on event arrival. Restarting the clock
-- on every event can starve: an app that retitles continuously (some web apps
-- rotate a notification counter through the title several times a second) would
-- postpone the deadline forever and the place would never be recorded. Keying on
-- the place means a pending timer for where you already are is left to expire;
-- the clock only restarts when you genuinely move, which is the case the dwell
-- exists for.
--
-- Both sources feed this one timer. The AX observer schedules "window:<cgid>"
-- with no payload, meaning "re-read the focused window when the timer fires". The
-- Chrome extension schedules "chrome_tab:<tabId>" WITH a payload, because that
-- entry can only come from the extension. A Chrome window is therefore covered
-- exactly once, and switching tabs inside one window restarts the clock -- a
-- different place, even though the macOS window hasn't changed.
--
-- isStandard() in currentWindowEntry catches the structurally-transient windows;
-- this catches the ones that are ordinary places but merely passed through.
local function scheduleDwell(key, entry)
  if _G._FocusHistoryDwellTimer then
    if _G._FocusHistoryDwellKey == key then
      -- Same place: keep the deadline, but take the fresher payload (a title may
      -- have changed since).
      if entry then _G._FocusHistoryDwellEntry = entry end
      return
    end
    _G._FocusHistoryDwellTimer:stop()
  end

  _G._FocusHistoryDwellKey = key
  _G._FocusHistoryDwellEntry = entry
  _G._FocusHistoryDwellTimer = hs.timer.doAfter(M.dwell, function()
    local pending = _G._FocusHistoryDwellEntry
    _G._FocusHistoryDwellTimer = nil
    _G._FocusHistoryDwellKey = nil
    _G._FocusHistoryDwellEntry = nil

    -- Re-check the jump gates here, not just at schedule time: a jump can start
    -- during the dwell, and recording then would push the window we are leaving.
    if st.busy then return end
    if st.settleUntil and hs.timer.secondsSinceEpoch() < st.settleUntil then return end

    if pending then record(pending) else commit() end
  end)
end

-- Settle whatever is mid-dwell right now and record it. Returns true if it did.
--
-- This is what makes forward navigation work when you jump before the dwell has
-- elapsed. It has to use the PENDING entry rather than re-reading the focused
-- window, because for a Chrome tab those differ: the pending entry is
-- chrome_tab:<tabId>, while currentWindowEntry() would look at the same macOS
-- window, find an older chrome_tab for it already in the stack, and correctly
-- refuse to record a colliding window entry -- returning nil. So the tab you were
-- on never got recorded, the jump ran from a stale cursor, and there was nothing
-- to go forward to.
local function flushDwell()
  if not _G._FocusHistoryDwellTimer then return false end
  -- Don't tear down the pending dwell if we aren't allowed to record it.
  if st.busy then return false end
  if st.settleUntil and hs.timer.secondsSinceEpoch() < st.settleUntil then return false end

  local pending = _G._FocusHistoryDwellEntry
  _G._FocusHistoryDwellTimer:stop()
  _G._FocusHistoryDwellTimer = nil
  _G._FocusHistoryDwellKey = nil
  _G._FocusHistoryDwellEntry = nil

  -- No payload means the AX path scheduled it: read the window now, as the timer
  -- would have.
  record(pending or currentWindowEntry())
  return true
end

-- `immediate` deliberately bypasses the dwell, and that is not a loophole. It is
-- the hotkey path: pressing hyper+o is not flicking past a window, it is acting
-- from one, so that window is a real position and the cursor has to reflect it.
-- Skip it and "back" would step from wherever you last came to rest, silently
-- passing over the window you are actually looking at -- and you would have
-- nothing to go forward to afterwards.
local function observe(done, immediate)
  if immediate then
    if not flushDwell() then commit() end
    if done then done() end
    return
  end

  local win = hs.window.focusedWindow()
  local winId = win and win:id()

  -- The extension has a tab pending for this very window, and its entry is the
  -- better one -- richer, and keyed as a tab. Scheduling ours would replace it
  -- with a plain window entry for the same place, which is the dual-key
  -- collision that truncates branches.
  local pending = _G._FocusHistoryDwellEntry
  if pending and winId and pending.cgWindowId == tostring(winId) then
    if done then done() end
    return
  end

  scheduleDwell("window:" .. tostring(winId), nil)
  if done then done() end
end

-- Contribute a place from outside (the Chrome extension, via chromebridge).
-- Subject to the same dwell as anything else: flicking through tabs looking for
-- the right one should leave no more trace than flicking through windows.
function M.recordDwelled(entry)
  if not entry then return end
  if st.busy then return end
  if st.settleUntil and hs.timer.secondsSinceEpoch() < st.settleUntil then return end
  scheduleDwell(entryKey(entry), entry)
end

---------------------------------------------------------------
-- Focusing an entry
---------------------------------------------------------------

-- Has focus actually arrived at `entry`? yabai reports success as soon as it has
-- asked, before macOS has made the window key. Declaring the jump finished early
-- is not cosmetic: st.busy is what suppresses recording mid-jump, so clearing it
-- too soon lets the focus event for the window we are LEAVING land in the
-- history, where it doesn't match the cursor, gets pushed, and truncates the
-- forward branch.
--
-- Same 20ms/20-try shape as smartcmdtab.lua.
local function verifyLanded(entry, cb, tries)
  tries = tries or 0
  local win = hs.window.focusedWindow()
  if win and tostring(win:id()) == entry.id then return cb(true) end
  if tries >= 20 then return cb(false) end
  hs.timer.doAfter(0.02, function() verifyLanded(entry, cb, tries + 1) end)
end

local function focusEntry(entry, cb)
  local handler = M.focusHandlers[entry.kind]
  if handler then return handler(entry, cb) end

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
    -- Even with verification, an event already queued from the transition can
    -- arrive just after busy clears and describe the window we left. Ignore
    -- observations for a beat -- shorter than any deliberate human app switch,
    -- and skipping one is harmless because the next real focus change records
    -- correctly.
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

  -- Bring the history up to date first, so a focus change that arrived through an
  -- app posting no AX notification is still accounted for. This is what makes the
  -- hotkey self-healing rather than dependent on perfect event coverage.
  local started = false
  local function go()
    if started then return end
    started = true
    jumpToIndex(st.cursor, delta)
  end
  observe(go, true)
  hs.timer.doAfter(SETTLE_TIMEOUT, go)
end

function M.back() jump(-1) end
function M.forward() jump(1) end

-- Contribute an entry from outside (chromebridge). Gated exactly like an AX
-- observation: during a jump the cursor is already where it belongs, so an
-- inbound report about the window we are landing on -- or leaving -- must not
-- rewrite the stack.
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
      subText = shortApp(e.app),
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
  -- Reloads must not leave the old observers running.
  if _G._FocusHistoryAppWatcher then
    pcall(function() _G._FocusHistoryAppWatcher:stop() end)
  end
  for _, w in pairs(_G._FocusHistoryAppWatchers or {}) do
    pcall(function() w:stop() end)
  end
  _G._FocusHistoryAppWatchers = {}
  if _G._FocusHistoryDwellTimer then
    pcall(function() _G._FocusHistoryDwellTimer:stop() end)
    _G._FocusHistoryDwellTimer = nil
  end
  _G._FocusHistoryDwellKey = nil
  _G._FocusHistoryDwellEntry = nil

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
  observe(nil, true)
end

return M
