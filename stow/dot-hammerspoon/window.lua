local M = {}

function M.approximatelyEqual(a, b)
  local diff = math.abs(a - b)
  return diff < 0.01
end

function M.adjust(x, y, w, h)
  return function()
    local win = hs.window.focusedWindow()

    if not win or win:isFullScreen() then return end

    local f = win:frame()
    local max = win:screen():frame()

    f.w = math.floor(max.w * w)
    f.h = math.floor(max.h * h)
    f.x = math.floor((max.w * x) + max.x)
    f.y = math.floor((max.h * y) + max.y)

    win:setFrame(f)
  end
end

function M.adjustCenter(w, h)
  return function()
    local win = hs.window.focusedWindow()
    if not win then return end

    local f = win:frame()
    local max = win:screen():frame()

    f.w = math.floor(max.w * w)
    f.h = math.floor(max.h * h)
    f.x = math.floor((max.w / 2) - (f.w / 2))
    f.y = math.floor((max.h / 2) - (f.h / 2))
    win:setFrame(f)
  end
end

function M.getCurrentProportions()
  local win = hs.window.focusedWindow()
  if not win then return end

  local f = win:frame()
  local max = win:screen():frame()

  return {
    w = f.w / max.w,
    h = f.h / max.h,
    x = f.x / max.w,
    y = f.y / max.h
  }
end

function M.setWindowConfig(config)
  local win = hs.window.focusedWindow()
  if not win or win:isFullScreen() then return end

  local f = win:frame()
  local max = win:screen():frame()

  f.w = math.floor(max.w * config.w)
  f.h = math.floor(max.h * config.h)
  f.x = math.floor((max.w * config.x) + max.x)
  f.y = math.floor((max.h * config.y) + max.y)

  win:setFrame(f)
end

function M.adjustCycle(windowConfigs)
  return function()
    local win = hs.window.focusedWindow()
    if not win or win:isFullScreen() then return end

    local current = M.getCurrentProportions()

    local config
    local nextConfig

    for i = 1, #windowConfigs do
      config = windowConfigs[i]

      if M.approximatelyEqual(config.w, current.w) and M.approximatelyEqual(config.x, current.x) then
        nextConfig = windowConfigs[(i % #windowConfigs) + 1]

        M.setWindowConfig(nextConfig)
        return
      end
    end

    M.setWindowConfig(windowConfigs[1])
  end
end

return M

-- Example key bindings 
-- -- top half
-- hs.hotkey.bind(mash.ctrlCmd, "up", adjust(0, 0, 1, 0.5))
--
-- -- right half
-- hs.hotkey.bind(mash.ctrlCmd, "right", adjust(0.5, 0, 0.5, 1))
-- hs.hotkey.bind(mash.ctrlCmd, ".", adjustCycle({
--   { x = 0.5, y = 0, w = 0.5, h = 1 },
--   { x = 0.75, y = 0, w = 0.25, h = 1 },
--   { x = 0.625, y = 0, w = 0.375, h = 1 },
--   { x = 0.5, y = 0, w = 0.25, h = 1 },
-- }))
-- hs.hotkey.bind(mash.ctrlShiftCmd, ".", adjustCycle({
--   { x = 0.25, y = 0, w = 0.75, h = 1 },
--   { x = 0.375, y = 0, w = 0.625, h = 1 },
-- }))
--
-- -- bottom half
-- hs.hotkey.bind(mash.ctrlCmd, "down", adjust(0, 0.5, 1, 0.5))
--
-- -- left half
-- hs.hotkey.bind(mash.ctrlCmd, "left", adjust(0, 0, 0.5, 1))
-- hs.hotkey.bind(mash.ctrlCmd, ",", adjustCycle({
--   { x = 0, y = 0, w = 0.5, h = 1 },
--   { x = 0, y = 0, w = 0.25, h = 1 },
--   { x = 0, y = 0, w = 0.375, h = 1 },
--   { x = 0.25, y = 0, w = 0.25, h = 1 }
-- }))
--
-- hs.hotkey.bind(mash.ctrlShiftCmd, ",", adjustCycle({
--   { x = 0, y = 0, w = 0.75, h = 1 },
--   { x = 0, y = 0, w = 0.625, h = 1 },
-- }))
--
-- -- top left
-- hs.hotkey.bind(mash.altCmd, "up", adjust(0, 0, 0.5, 0.5))
--
-- -- top right
-- hs.hotkey.bind(mash.altCmd, "right", adjust(0.5, 0, 0.5, 0.5))
--
-- -- bottom right
-- hs.hotkey.bind(mash.altCmd, "down", adjust(0.5, 0.5, 0.5, 0.5))
--
-- -- bottom left
-- hs.hotkey.bind(mash.altCmd, "left", adjust(0, 0.5, 0.5, 0.5))
--
-- -- fullscreen
-- hs.hotkey.bind(mash.ctrlCmd, "m", adjust(0, 0, 1, 1))
