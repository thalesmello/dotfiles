-- Short, live timer readout. One non-activating canvas, updated in place rather
-- than closing/recreating alerts on every tick. Stays for 3 seconds by default,
-- with a native fade during the last second. Updates never extend its lifetime.
local util = require("util")
local M = {}
local st = _G._TimerReadout or {generation = 0}
_G._TimerReadout = st

function M.clear()
  st.generation = st.generation + 1
  if st.updateTimer then st.updateTimer:stop(); st.updateTimer = nil end
  if st.fadeTimer then st.fadeTimer:stop(); st.fadeTimer = nil end
  if st.hideTimer then st.hideTimer:stop(); st.hideTimer = nil end
  if st.canvas then
    pcall(function() st.canvas:delete() end)
    st.canvas = nil
  end
end

function M.show(readMessage, duration)
  M.clear()
  local generation = st.generation
  local lifetime = duration or 3
  local fadeDuration = math.min(1, lifetime)
  local ok, err = pcall(function()
    local win = hs.window.focusedWindow()
    local screen = (win and win:screen()) or hs.screen.mainScreen()
    local frame = screen:frame()
    local width, height = math.min(620, frame.w - 40), 74
    local canvas = hs.canvas.new({
      x = frame.x + (frame.w - width) / 2,
      y = frame.y + (frame.h - height) / 2,
      w = width, h = height,
    })
    st.canvas = canvas
    canvas:level(hs.canvas.windowLevels.overlay)
    canvas:behaviorAsLabels({"canJoinAllSpaces", "stationary", "ignoresCycle", "fullScreenAuxiliary"})
    canvas:clickActivating(false)
    canvas:canvasMouseEvents(false, false, false, false)
    canvas[1] = {
      type = "rectangle", action = "fill",
      roundedRectRadii = {xRadius = 12, yRadius = 12},
      fillColor = {white = 0.08, alpha = 0.9},
    }
    canvas[2] = {
      type = "text", text = tostring(readMessage()),
      frame = {x = 16, y = 21, w = width - 32, h = 36},
      textSize = 22, textAlignment = "center", textColor = {white = 1},
    }
    canvas:show()
    st.updateTimer = hs.timer.doEvery(0.1, function()
      if generation ~= st.generation then return end
      local updated, updateError = pcall(function()
        local message = tostring(readMessage())
        if canvas[2].text ~= message then canvas[2].text = message end
      end)
      if not updated then
        M.clear()
        util.log("timerReadout: " .. tostring(updateError))
      end
    end)
    st.fadeTimer = hs.timer.doAfter(lifetime - fadeDuration, function()
      if generation ~= st.generation then return end
      -- Native canvas fading stays smooth while the countdown text continues
      -- to update; don't restart hide() on each update.
      local faded, fadeError = pcall(function() canvas:hide(fadeDuration) end)
      if not faded then
        M.clear()
        util.log("timerReadout: " .. tostring(fadeError))
      end
    end)
    st.hideTimer = hs.timer.doAfter(lifetime, function()
      if generation == st.generation then M.clear() end
    end)
  end)
  if not ok then
    M.clear()
    util.log("timerReadout: " .. tostring(err))
  end
end

return M
