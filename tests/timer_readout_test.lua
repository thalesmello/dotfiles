-- Run: lua tests/timer_readout_test.lua
local root = debug.getinfo(1, "S").source:sub(2):match("^(.*)/tests/[^/]+$") or "."
local now, timers, canvases, logs = 0, {}, {}, {}
local function timer(seconds, callback)
  local t = {seconds = seconds, callback = callback}
  function t:stop() self.stopped = true end
  timers[#timers + 1] = t
  return t
end
hs = {
  window = {focusedWindow = function() return nil end},
  screen = {mainScreen = function()
    return {frame = function() return {x = -1920, y = 100, w = 1920, h = 1080} end}
  end},
  timer = {doEvery = timer, doAfter = timer},
  canvas = {
    windowLevels = {overlay = 25},
    new = function(frame)
      local c = {frame = frame}
      function c:level(level) assert(level == 25) end
      function c:behaviorAsLabels(labels) assert(#labels == 4) end
      function c:clickActivating(flag) assert(not flag) end
      function c:canvasMouseEvents(down, up, enterExit, move)
        assert(not down and not up and not enterExit and not move)
      end
      function c:show() self.shown = true end
      function c:hide(seconds)
        self.fadeSeconds = seconds
        self.fadeCalls = (self.fadeCalls or 0) + 1
      end
      function c:delete() self.deleted = true end
      canvases[#canvases + 1] = c
      return c
    end,
  },
}
package.preload["util"] = function() return {log = function(err) logs[#logs + 1] = err end} end
local M = dofile(root .. "/stow_modules/main/dot-hammerspoon/timerReadout.lua")
local function message()
  return string.format("Focus timer: %ds remaining", math.ceil(120 - now))
end
M.show(message, 3)
local first = canvases[1]
local update, fade, hide = _G._TimerReadout.updateTimer, _G._TimerReadout.fadeTimer, _G._TimerReadout.hideTimer
assert(first.shown and first.frame.x < 0)
assert(first[2].text == "Focus timer: 120s remaining")
assert(update.seconds == 0.1 and fade.seconds == 2 and hide.seconds == 3)
now = 1.1
update.callback()
assert(first[2].text == "Focus timer: 119s remaining")
assert(not first.fadeCalls, "first two seconds must remain fully visible")
assert(#canvases == 1, "updates must reuse the SAME canvas, not stack/flicker alerts")
assert(not hide.stopped and hide.seconds == 3, "updates must not reset the display lifetime")
now = 2
fade.callback()
assert(first.fadeSeconds == 1 and first.fadeCalls == 1 and not first.deleted)
now = 2.5
update.callback()
assert(first[2].text == "Focus timer: 118s remaining", "countdown must remain live DURING fade")
assert(first.fadeCalls == 1, "updates must not restart the fade")
now = 3
hide.callback()
assert(first.deleted and update.stopped and fade.stopped and hide.stopped)
assert(not _G._TimerReadout.canvas and not _G._TimerReadout.updateTimer and not _G._TimerReadout.fadeTimer)

-- Repeated presses replace the existing readout; old queued callbacks cannot
-- modify or delete the new message.
M.show(message)
local second = canvases[2]
local oldUpdate, oldFade, oldHide = _G._TimerReadout.updateTimer, _G._TimerReadout.fadeTimer, _G._TimerReadout.hideTimer
assert(oldHide.seconds == 3 and oldFade.seconds == 2, "default duration must be 3 seconds with final-second fade")
M.show(function() return "Anti-distraction timer: 1:05 remaining (paused)" end)
local third = canvases[3]
assert(second.deleted and oldUpdate.stopped and oldFade.stopped and oldHide.stopped)
oldUpdate.callback()
oldFade.callback()
oldHide.callback()
assert(not third.deleted and not third.fadeCalls and third[2].text == "Anti-distraction timer: 1:05 remaining (paused)")
M.clear()
assert(third.deleted)

-- Provider errors clean up instead of leaving stale UI or repeating errors.
local fail = false
M.show(function()
  if fail then error("timer became unavailable") end
  return "Focus timer: 1:00 remaining"
end)
local last = canvases[#canvases]
fail = true
_G._TimerReadout.updateTimer.callback()
assert(last.deleted and #logs == 1 and not _G._TimerReadout.updateTimer)

-- Reload/re-setup cleanup also removes the transient readout.
M.show(message)
last = canvases[#canvases]
M = dofile(root .. "/stow_modules/main/dot-hammerspoon/timerReadout.lua")
M.clear()
assert(last.deleted and not _G._TimerReadout.hideTimer)
print("ALL LIVE TIMER READOUT TESTS PASSED!")
