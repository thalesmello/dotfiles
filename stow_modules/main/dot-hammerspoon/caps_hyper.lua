-- Hyper key.
--
-- Makes Caps Lock behave as Control+Command+Option while held, and Escape when
-- tapped (released within the threshold without pressing another key). This
-- mirrors the Karabiner rule in karabiner.edn:
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
-- This is set up unconditionally -- Hammerspoon owns Caps Lock whether or not
-- Karabiner is running. (It used to probe for karabiner_grabber first and only
-- arm itself as a fallback.) With Karabiner also running, the hidutil remap
-- means Karabiner's own ##caps_lock rule never matches, since by the time it
-- sees the key it is already F19.

local util = require("util")

local M = {}

-- USB HID usage IDs (keyboard usage page 0x07) for the hidutil remap.
local CAPS_LOCK_HID = 0x700000039
local F19_HID = 0x70000006E

-- Replace the system key map with a single src->dst remap, or clear it entirely
-- when called with nil HIDs.
--
-- Async by default, so the hidutil call stays off the config load path. `sync`
-- is for the shutdown path only: Hammerspoon tears down before an hs.task
-- completion callback would ever run, so restoring Caps Lock has to block.
--
-- hs.task takes an argv list, so the JSON payload goes through as a single
-- argument -- no shell, and no quoting to get wrong (the previous hs.execute
-- wrapped it in single quotes and forked /bin/sh for it).
local function setMapping(srcHid, dstHid, sync)
  local payload
  if srcHid and dstHid then
    payload = string.format(
      '{"UserKeyMapping":[{"HIDKeyboardModifierMappingSrc":0x%X,"HIDKeyboardModifierMappingDst":0x%X}]}',
      srcHid, dstHid)
  else
    payload = '{"UserKeyMapping":[]}'
  end

  local task = hs.task.new("/usr/bin/hidutil", nil, {"property", "--set", payload})
  if sync then
    task:start():waitUntilExit()
  else
    task:start()
  end
end

-- Arm the remap and the F19 eventtap.
local function enable(threshold)
  -- Restore Caps Lock when Hammerspoon reloads/quits so it isn't left as a dead
  -- key. Registered *before* the remap so there is no window in which the
  -- mapping is live without a matching teardown. Synchronous by necessity.
  local prevShutdown = hs.shutdownCallback
  hs.shutdownCallback = function()
    setMapping(nil, nil, true)
    if prevShutdown then prevShutdown() end
  end

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
end

function M.setup(opts)
  opts = opts or {}
  local threshold = opts.threshold or 0.15 -- seconds; matches Karabiner :alone 150

  util.log("caps_hyper: enabling hyper key")
  -- Nothing blocking here: enable() only registers a shutdown hook and an
  -- eventtap, and its hidutil call is a fire-and-forget hs.task. This used to
  -- shell out twice synchronously (pgrep, then hidutil) for ~31-40ms of a ~90ms
  -- config load.
  enable(threshold)
end

return M
