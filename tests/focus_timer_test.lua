-- Run: lua tests/focus_timer_test.lua (or nvim --headless -u NONE -l ...)
local root = debug.getinfo(1, "S").source:sub(2):match("^(.*)/tests/[^/]+$") or "."
local modulePath = root .. "/stow_modules/main/dot-hammerspoon/focusTimer.lua"
local now, settings, timers, canvases, messages, logs
local failCanvasSetup, failCanvasDraw
local focusedWindow
local liveReadout
local screens = {
  {x = 0, y = 0, w = 1920, h = 1080},
  {x = -2560, y = -300, w = 2560, h = 1440},
}

local function reset()
  now, settings, timers, canvases, messages, logs = 1000, {}, {}, {}, {}, {}
  failCanvasSetup, failCanvasDraw = false, false
  focusedWindow = nil
  liveReadout = nil
  _G._FocusTimerState = nil
end

local function timer(delay, fn, repeating)
  local t = {due = now + delay, fn = fn, interval = repeating and delay or nil}
  function t:stop() self.stopped = true end
  timers[#timers + 1] = t
  return t
end

local function advance(seconds)
  local target = now + seconds
  while true do
    local nextTimer
    for _, t in ipairs(timers) do
      if not t.stopped and t.due <= target and (not nextTimer or t.due < nextTimer.due) then nextTimer = t end
    end
    if not nextTimer then break end
    now = nextTimer.due
    if nextTimer.interval then nextTimer.due = now + nextTimer.interval else nextTimer.stopped = true end
    nextTimer.fn()
  end
  now = target
end

_G.hs = {
  window = {focusedWindow = function() return focusedWindow end},
  settings = {
    get = function(k) return settings[k] end,
    set = function(k, v) settings[k] = v end,
  },
  timer = {
    secondsSinceEpoch = function() return now end,
    doAfter = function(delay, fn) return timer(delay, fn, false) end,
    doEvery = function(delay, fn) return timer(delay, fn, true) end,
  },
  screen = {allScreens = function()
    local result = {}
    for _, frame in ipairs(screens) do
      result[#result + 1] = {fullFrame = function() return frame end}
    end
    return result
  end},
  canvas = {
    windowLevels = {overlay = 25},
    new = function(frame)
      local c = {frame = frame, elements = {}, assignments = 0}
      function c:level(level) assert(level == 25); return self end
      function c:behaviorAsLabels(labels)
        if failCanvasSetup then error("screen disappeared") end
        self.behaviors = labels; return self
      end
      function c:clickActivating(flag) assert(flag == false); self.activating = flag; return self end
      function c:canvasMouseEvents(down, up, enterExit, move)
        assert(not down and not up and not enterExit and not move)
        self.tracksMouse = false; return self
      end
      function c:show() self.shown = true; return self end
      function c:delete() self.deleted = true end
      setmetatable(c, {__newindex = function(self, k, v)
        if type(k) == "number" then
          if failCanvasDraw then error("canvas no longer available") end
          assert(v.type == "segments" and v.action == "stroke", "fireworks should be spark segments, never a countdown")
          assert(#v.coordinates == 2 and v.strokeColor.alpha >= 0 and v.strokeColor.alpha <= 1)
          self.elements[k] = v
          self.assignments = self.assignments + 1
        else rawset(self, k, v) end
      end})
      canvases[#canvases + 1] = c
      return c
    end,
  },
}
package.preload["timerReadout"] = function()
  return {
    show = function(reader, duration)
      assert(duration == 3)
      liveReadout = reader
      messages[#messages + 1] = reader()
    end,
    clear = function() liveReadout = nil end,
  }
end
package.preload["preset"] = function() return {displayMessage = function(msg) messages[#messages + 1] = msg end} end
package.preload["util"] = function() return {log = function(msg) logs[#logs + 1] = msg end} end

-- Cycle durations/off, cancelled callbacks and a fresh cycle after off.
reset()
local M = dofile(modulePath)
M.setup()
assert(#canvases == 0 and not _G._FocusTimerState.timer)
M.cycle()
assert(_G._FocusTimerState.deadline == now + 120 and messages[#messages] == "Focus timer: 2min")
local old = _G._FocusTimerState.timer
advance(10)
M.cycle()
assert(old.stopped and _G._FocusTimerState.deadline == now + 1500)
assert(messages[#messages] == "Focus timer: 25min")
old.fn() -- simulate a queued, obsolete callback
assert(#canvases == 0 and _G._FocusTimerState.index == 2)
M.cycle()
assert(_G._FocusTimerState.deadline == now + 300 and messages[#messages] == "Focus timer: 5min")
local cancelled = _G._FocusTimerState.timer
M.cycle()
assert(cancelled.stopped and not _G._FocusTimerState.deadline and not _G._FocusTimerState.timer)
assert(messages[#messages] == "Focus timer off")
advance(1600)
cancelled.fn()
assert(#canvases == 0)
M.cycle()
assert(_G._FocusTimerState.index == 1)

-- Fireworks on ALL screens exactly at expiry, with no countdown or window API.
reset()
M = dofile(modulePath)
M.setup()
M.cycle()
advance(119.99)
assert(#canvases == 0 and #messages == 1, "there must be no countdown display")
advance(0.01)
assert(#canvases == #screens)
assert(_G._FocusTimerState.index == 0 and not _G._FocusTimerState.deadline)
for i, c in ipairs(canvases) do
  assert(c.shown and c.frame == screens[i] and not c.activating and not c.tracksMouse)
  assert(#c.elements == 72)
end
local first = canvases[1].elements[1].coordinates[1].x
advance(0.3)
assert(canvases[1].elements[1].coordinates[1].x ~= first, "sparks must animate rather than stay static")
advance(1)
for _, c in ipairs(canvases) do assert(c.deleted, "brief animation must remove all overlays") end
assert(not _G._FocusTimerState.animationTimer and #_G._FocusTimerState.canvases == 0)
advance(10)
assert(#canvases == 2, "completion must not repeat")
M.cycle()
assert(_G._FocusTimerState.index == 1, "completion resets the cycle to 2min")

-- Reloads preserve the deadline, stop old timers and delete an active animation.
reset()
M = dofile(modulePath)
M.setup()
M.cycle()
advance(45)
local original = _G._FocusTimerState.timer
M.setup()
assert(original.stopped and _G._FocusTimerState.deadline == 1120)
original.fn()
assert(#canvases == 0)
-- Full restart: userdata is gone but hs.settings survives.
_G._FocusTimerState.timer:stop()
_G._FocusTimerState = nil
M = dofile(modulePath)
M.setup()
assert(_G._FocusTimerState.index == 1 and _G._FocusTimerState.deadline == 1120)
advance(75)
assert(#canvases == 2)
local animation = _G._FocusTimerState.animationTimer
M.setup()
assert(animation.stopped)
for _, c in ipairs(canvases) do assert(c.deleted) end
assert(not _G._FocusTimerState.timer)

-- Completion during downtime is delivered once after startup.
reset()
settings["focus_timer.session"] = {index = 2, deadline = now - 10}
M = dofile(modulePath)
M.setup()
advance(0.02)
assert(#canvases == 2)
assert(settings["focus_timer.session"].index == 0)

-- Partial canvas creation or draw failure cannot leave an overlay stuck up.
reset()
M = dofile(modulePath)
M.setup()
M.cycle()
failCanvasSetup = true
advance(120)
assert(#logs == 1)
for _, c in ipairs(canvases) do assert(c.deleted) end
assert(not _G._FocusTimerState.animationTimer)
reset()
M = dofile(modulePath)
M.setup()
M.cycle()
advance(120)
failCanvasDraw = true
advance(0.1)
assert(#logs == 1)
for _, c in ipairs(canvases) do assert(c.deleted) end
assert(not _G._FocusTimerState.animationTimer)

-- Main-stow default hotkey works without loading ANY meta-dotfiles module.
reset()
M = dofile(modulePath)
local shortcut, showRemaining, modifiers = nil, nil, {"ctrl", "alt", "cmd", "shift"}
local hyper = {"ctrl", "alt", "cmd"}
M.setup({
  default = {bindOnce = function(_, mods, key, name, fn)
    assert(mods == modifiers and key == "t" and name == "Focus: Cycle Timer")
    shortcut = fn
  end},
  hyperShift = modifiers,
  hyper = hyper,
  service = {bindOnce = function(_, mods, key, name, fn)
    assert(mods == hyper and key == "t" and name == "Timer: Time Remaining")
    showRemaining = fn
  end},
})
assert(showRemaining, "shared setup must register Service > hyper+t")
showRemaining()
assert(messages[#messages] == "No timer running" and not M.isActive())
assert(M.remaining() == nil)
assert(shortcut, "shared setup must register the default shortcut")
shortcut()
assert(messages[#messages] == "No focused window")
assert(not _G._FocusTimerState.timer)
focusedWindow = {} -- routing rules belong to local config, not the shared timer
shortcut()
assert(messages[#messages] == "Focus timer: 2min")
assert(_G._FocusTimerState.deadline == now + 120)
shortcut()
assert(messages[#messages] == "Focus timer: 25min")
local deadline = _G._FocusTimerState.deadline
advance(25.2)
showRemaining()
assert(messages[#messages] == "Focus timer: 24:35 remaining")
assert(M.isActive() and M.remaining() > 0)
assert(_G._FocusTimerState.deadline == deadline, "readout must not change the deadline")
advance(1)
assert(liveReadout() == "Focus timer: 24:34 remaining", "readout must be a live provider, not a snapshot")
assert(_G._FocusTimerState.deadline == deadline)

-- Coordination hooks fire before a new focus session and on restoration, but
-- never on Off; extensions can unsubscribe across their own repeated setup.
reset()
M = dofile(modulePath)
M.setup()
local starts = 0
local stopListening = M.onStart(function()
  starts = starts + 1
  if starts == 1 then assert(not M.isActive(), "notify before activating focus") end
end)
M.cycle()
assert(starts == 1)
M.setup()
assert(starts == 2, "restoring focus should notify existing extensions")
M.cycle()
M.cycle()
assert(starts == 4)
M.cycle() -- off
assert(starts == 4 and not M.isActive())
stopListening()
M.cycle()
assert(starts == 4, "unsubscribed extensions must not be called")

-- Real Mode/palette integration: local Service status replaces the shared
-- command under the SAME fully-resolved chord, rather than leaving a '?' entry.
reset()
local choices, selected
hs.hotkey = {bind = function() return {} end}
hs.chooser = {new = function(callback)
  selected = callback
  return {choices = function(_, value) choices = value end, show = function() end}
end}
local palette = dofile(root .. "/stow_modules/main/dot-hammerspoon/palette.lua")
package.loaded["palette"] = palette
local Mode = dofile(root .. "/stow_modules/main/dot-hammerspoon/mode.lua").Mode
local default = setmetatable({_prefix = ""}, Mode)
local service = setmetatable({_name = "Service"}, Mode)
default:bindEnter(hyper, "space", "Enter Service Mode", service)
M = dofile(modulePath)
M.setup({default = default, hyperShift = modifiers, hyper = hyper, service = service})
service:bindOnce(hyper, "t", "Timer: Time Remaining", function()
  messages[#messages + 1] = "Anti-distraction timer: 1:30 remaining"
end)
palette.showCommandPalette()
local statusChoice, statusCount = nil, 0
for _, choice in ipairs(choices) do
  if choice.text:find("Timer: Time Remaining", 1, true) then
    statusChoice, statusCount = choice, statusCount + 1
    assert(choice.text:find("✦space [Service] > ✦t", 1, true))
    assert(not choice.text:find("?", 1, true))
  end
end
assert(statusCount == 1, "main/local status must occupy one palette entry")
selected(statusChoice)
assert(messages[#messages] == "Anti-distraction timer: 1:30 remaining")
local file = assert(io.open(root .. "/stow_modules/main/dot-hammerspoon/keybindings.lua", "r"))
local bindingsSource = file:read("*a"); file:close()
local enter = assert(bindingsSource:find('default:bindEnter(hyper, "space", "Enter Service Mode", service)', 1, true))
local setup = assert(bindingsSource:find('require("focusTimer").setup', 1, true))
assert(setup > enter, "main setup must follow Service entry-chord registration")

print("ALL FOCUS TIMER TESTS PASSED!")
