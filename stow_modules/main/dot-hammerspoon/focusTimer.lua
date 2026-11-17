-- Manual focus timer shared by personal and work machines.
-- One wall-clock timer, independent of any work-only auto-hide alarm.
-- meta-dotfiles overrides the shortcut in distracting windows when enabled.
-- No ticking HUD: only a short selection toast and 1.2s of fireworks at the end.
local Preset = require("preset")
local util = require("util")
local M = {}

local SETTINGS_KEY = "focus_timer.session"
local INCREMENTS = {
  {seconds = 120, label = "2min"},
  {seconds = 1500, label = "25min"},
  {seconds = 300, label = "5min"},
}
local FIREWORK_SECONDS = 1.2
local FPS = 30
local SPARKS = 24
local COLORS = {
  {red = 1, green = 0.65, blue = 0.15},
  {red = 0.3, green = 0.8, blue = 1},
  {red = 1, green = 0.35, blue = 0.65},
}

-- Keep userdata reachable and tear it down on repeated setup in one Lua state.
-- Only plain deadline/index data goes into hs.settings across full reloads.
local st = _G._FocusTimerState or {index = 0, generation = 0, canvases = {}}
_G._FocusTimerState = st

local function stopTimer()
  st.generation = st.generation + 1
  if st.timer then st.timer:stop(); st.timer = nil end
end

local function clearFireworks()
  if st.animationTimer then st.animationTimer:stop(); st.animationTimer = nil end
  for _, canvas in ipairs(st.canvases) do
    pcall(function() canvas:delete() end)
  end
  st.canvases = {}
end

local function save()
  hs.settings.set(SETTINGS_KEY, {index = st.index, deadline = st.deadline})
end

local function showFireworks()
  clearFireworks()
  local startedAt = hs.timer.secondsSinceEpoch()
  local displays = {}
  local ok, err = pcall(function()
    -- Use each monitor's global fullFrame, including negative display offsets;
    -- all spark coordinates below are local to that monitor's canvas.
    for _, screen in ipairs(hs.screen.allScreens()) do
      local frame = screen:fullFrame()
      local canvas = hs.canvas.new(frame)
      st.canvases[#st.canvases + 1] = canvas
      canvas:level(hs.canvas.windowLevels.overlay)
      canvas:behaviorAsLabels({"canJoinAllSpaces", "stationary", "ignoresCycle", "fullScreenAuxiliary"})
      canvas:clickActivating(false)
      canvas:canvasMouseEvents(false, false, false, false)
      displays[#displays + 1] = {canvas = canvas, w = frame.w, h = frame.h}
    end

    local function draw(elapsed)
      for _, display in ipairs(displays) do
        local scale = math.min(display.w, display.h)
        for burst, color in ipairs(COLORS) do
          local age = math.max(0, elapsed - (burst - 1) * 0.12)
          local alpha = math.max(0, 1 - age / 0.95)
          local cx = display.w * (0.25 + (burst - 1) * 0.25)
          local cy = display.h * (burst == 2 and 0.35 or 0.5)
          local radius = scale * 0.23 * (1 - math.exp(-3 * age))
          local fall = scale * 0.07 * age * age
          for spark = 1, SPARKS do
            local angle = 2 * math.pi * spark / SPARKS + burst * 0.3
            local length = scale * 0.014
            display.canvas[(burst - 1) * SPARKS + spark] = {
              type = "segments", action = "stroke", strokeWidth = 2.5,
              strokeCapStyle = "round",
              strokeColor = {red = color.red, green = color.green, blue = color.blue, alpha = alpha},
              coordinates = {
                {x = cx + math.cos(angle) * radius, y = cy + math.sin(angle) * radius + fall},
                {x = cx + math.cos(angle) * (radius + length), y = cy + math.sin(angle) * (radius + length) + fall},
              },
            }
          end
        end
      end
    end

    draw(0)
    for _, canvas in ipairs(st.canvases) do canvas:show() end
    st.animationTimer = hs.timer.doEvery(1 / FPS, function()
      local elapsed = hs.timer.secondsSinceEpoch() - startedAt
      if elapsed >= FIREWORK_SECONDS then clearFireworks(); return end
      local drawn, drawError = pcall(draw, elapsed)
      if not drawn then
        clearFireworks()
        util.log("focus_timer: fireworks error: " .. tostring(drawError))
      end
    end)
  end)
  if not ok then
    clearFireworks()
    util.log("focus_timer: fireworks error: " .. tostring(err))
  end
end

local function armTimer()
  stopTimer()
  local generation = st.generation
  local function complete()
    -- A cancelled/replaced timer's queued callback must not celebrate early.
    if generation ~= st.generation or not st.deadline then return end
    local remaining = st.deadline - hs.timer.secondsSinceEpoch()
    if remaining > 0 then
      st.timer = hs.timer.doAfter(remaining, complete)
      return
    end
    st.timer = nil
    st.index, st.deadline = 0, nil
    save()
    showFireworks()
  end
  st.timer = hs.timer.doAfter(math.max(0.01, st.deadline - hs.timer.secondsSinceEpoch()), complete)
end

function M.cycle()
  -- If a deadline passed while the event loop was busy, the next press starts
  -- at 2min rather than cycling an already-completed session.
  if st.deadline and st.deadline <= hs.timer.secondsSinceEpoch() then st.index = 0 end
  clearFireworks()
  st.index = (st.index + 1) % (#INCREMENTS + 1)
  stopTimer()
  local increment = INCREMENTS[st.index]
  if not increment then
    st.deadline = nil
    save()
    Preset.displayMessage("Focus timer off", 0.5)
    return
  end
  st.deadline = hs.timer.secondsSinceEpoch() + increment.seconds
  save()
  armTimer()
  Preset.displayMessage("Focus timer: " .. increment.label, 0.5)
end

function M.setup(ctx)
  stopTimer()
  clearFireworks()
  local saved = hs.settings.get(SETTINGS_KEY)
  st.index, st.deadline = 0, nil
  if type(saved) == "table" then
    local index, deadline = tonumber(saved.index), tonumber(saved.deadline)
    if index and INCREMENTS[index] and deadline and deadline > 0 and deadline < math.huge then
      st.index, st.deadline = index, deadline
      armTimer()
    end
  end

  -- Main config owns the default shortcut. Work-specific local bindings can
  -- override it afterward without putting distraction rules into this module.
  if ctx then
    ctx.default:bindOnce(ctx.hyperShift, "t", "Focus: Cycle Timer", function()
      if not hs.window.focusedWindow() then
        Preset.displayMessage("No focused window", 0.5)
        return
      end
      M.cycle()
    end)
  end
end

return M
