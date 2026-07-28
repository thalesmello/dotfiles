-- Fallback hyper key.
--
-- When Karabiner is NOT running, make Caps Lock behave as Control+Command+Option
-- while held, and Escape when tapped (released within the threshold without
-- pressing another key). This mirrors the Karabiner rule in karabiner.edn:
--   [:##caps_lock {:key :!CTleft_option ...} nil {:alone {:key :escape} :params {:alone 150}}]
--
-- macOS Caps Lock is a locking key, so it can't be observed as a momentary key
-- directly. We `hidutil`-remap the physical Caps Lock to F19 (an otherwise-unused
-- key -- F18 is taken by the mouse layer), then watch F19 via an eventtap. While
-- F19 is held we stamp Ctrl/Cmd/Opt onto the modifier flags of every other key
-- event, so the existing `hyper` hotkeys -- as well as third-party and system
-- hotkeys (iTerm, etc.) -- fire naturally; a quick standalone tap sends Escape.
--
-- We must set the flags on the key events themselves rather than posting bare
-- modifier keyDown events: synthetic modifier-only events do not update the
-- flags carried by the following key event, so Carbon hotkeys (used by
-- hs.hotkey and app global shortcuts) never see the modifiers.
--
-- Note: the Karabiner check runs once, at setup. If Karabiner stops later, reload
-- Hammerspoon to pick up the fallback.

local util = require("util")

local M = {}

-- USB HID usage IDs (keyboard usage page 0x07) for the hidutil remap.
local CAPS_LOCK_HID = 0x700000039
local F19_HID = 0x70000006E

-- Replace the system key map with a single src->dst remap, or clear it entirely
-- when called with no arguments.
local function setMapping(srcHid, dstHid)
  local payload
  if srcHid and dstHid then
    payload = string.format(
      '{"UserKeyMapping":[{"HIDKeyboardModifierMappingSrc":0x%X,"HIDKeyboardModifierMappingDst":0x%X}]}',
      srcHid, dstHid)
  else
    payload = '{"UserKeyMapping":[]}'
  end
  hs.execute(string.format("/usr/bin/hidutil property --set '%s'", payload))
end

local function karabinerRunning()
  -- pgrep exits 0 (status == true) when a matching process is found.
  local _, ok = hs.execute("/usr/bin/pgrep -x karabiner_grabber")
  return ok == true
end

function M.setup(opts)
  opts = opts or {}
  local threshold = opts.threshold or 0.15 -- seconds; matches Karabiner :alone 150

  if karabinerRunning() then
    util.log("caps_hyper: Karabiner running, skipping fallback hyper key")
    return
  end

  util.log("caps_hyper: Karabiner not running, enabling fallback hyper key")

  -- Remap physical Caps Lock to F19 so we can observe it as a momentary key.
  setMapping(CAPS_LOCK_HID, F19_HID)

  local f19 = hs.keycodes.map.f19

  local held = false
  local used = false
  local downAt = 0

  local types = hs.eventtap.event.types
  _G._CapsHyperTap = hs.eventtap.new({types.keyDown, types.keyUp}, function(event)
    local code = event:getKeyCode()

    if code == f19 then
      if event:getType() == types.keyDown then
        -- Ignore auto-repeat keyDowns while already held.
        if not held then
          held = true
          used = false
          downAt = hs.timer.secondsSinceEpoch()
        end
      else -- keyUp
        held = false
        if not used and (hs.timer.secondsSinceEpoch() - downAt) < threshold then
          hs.eventtap.keyStroke({}, "escape", 0)
        end
      end
      return true -- F19 itself never reaches apps
    end

    -- While held, stamp Ctrl/Cmd/Opt onto this key's flags (merging with any
    -- real modifiers like Shift) so app and system hotkeys see the hyper combo.
    if held then
      if event:getType() == types.keyDown then
        used = true -- a key was pressed while held -> no Escape on release
      end
      local flags = event:getFlags()
      flags.ctrl = true
      flags.alt = true
      flags.cmd = true
      event:setFlags(flags)
      return false
    end

    return false
  end)
  _G._CapsHyperTap:start()

  -- Restore Caps Lock when Hammerspoon reloads/quits so it isn't left as a dead key.
  local prevShutdown = hs.shutdownCallback
  hs.shutdownCallback = function()
    setMapping(nil, nil)
    if prevShutdown then prevShutdown() end
  end
end

return M
