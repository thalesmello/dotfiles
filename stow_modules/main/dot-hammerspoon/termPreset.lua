-- Cross-terminal (iTerm + Ghostty) control logic, ported from the `term-preset`
-- fish script so it can run IN-PROCESS inside Hammerspoon, the same way
-- ghosttyPreset.lua backs `ghostty-preset`. The keybindings call these functions
-- directly (no `task`, no `hs -c`).
--
-- The old shape cost more than a fish spawn: term-preset fanned every subcommand
-- out to iterm-preset AND ghostty-preset, and both of those are themselves
-- `hs -c` shims -- so `term-preset hide-floating-terminal` fired two round trips
-- back into Hammerspoon (plus three fish startups) to reach predicates that live
-- here anyway. Doing the fan-out in process makes those plain function calls on
-- Hammerspoon's single event loop: serialized, nothing to collide.
--
-- `bin/term-preset` is now a thin shim that dispatches each subcommand to the
-- matching function here via a single `hs -c`, so external CLI callers keep
-- working against one implementation.
--
-- Window iteration deliberately does NOT use hs.window/AX. `hs.window`'s
-- enumeration (allWindows/orderedWindows) queries every window of every running
-- app on this thread, with a 6s macOS timeout per app, which is what made the
-- hotkey lag in the first place. It reads yabai's window table instead -- yabai
-- reports CGWindowIDs, comparable across apps, unlike the per-app AppleScript id
-- spaces iterm-preset and ghostty-preset use -- and every subprocess it needs
-- runs through shell.task, off the event loop.

local Preset = require("preset")
local GhosttyPreset = require("ghosttyPreset")
local task = require("shell").task

local M = {}

local TERMINAL_APPS = { ["iTerm2"] = true, ["Ghostty"] = true }

-- Simple trace: which termPreset action a keybinding just invoked.
local function log(msg)
  print("[termPreset] " .. msg)
end

-----------------------------------------------------------------
-- Floating terminals
-----------------------------------------------------------------

-- True when EITHER terminal's floating window is active: the iTerm hotkey window
-- or the Ghostty quick terminal. Pure AX (preset.lua), no subprocess.
function M.isFloatingTerminal()
  return Preset.isFloatingTerminal()
end

-- Hide whichever floating terminal is active. Each branch is guarded by its own
-- predicate, so running both is safe when neither is up.
function M.hideFloatingTerminal()
  if Preset.isFloatingTerminalActive() then
    log("hide iTerm hotkey window")
    hs.osascript.applescript(
      'tell application "iTerm2" to hide hotkey window current window')
  end
  GhosttyPreset.hideFloatingTerminal()
end

-----------------------------------------------------------------
-- Window iteration
-----------------------------------------------------------------

-- Front-to-back ids of the on-screen terminal windows.
-- CGWindowListCopyWindowInfo reports the same ids yabai does, in stacking order,
-- and unlike an AX query it can't stall behind a busy app. Layer 0 skips overlays
-- (the floating/quick terminals). Run as a task rather than through
-- hs.osascript.javascript because the JXA bridge costs ~90ms and would spend all
-- of it on Hammerspoon's event loop.
local STACKED_IDS_JS = [[
  ObjC.import("CoreGraphics");
  ObjC.import("Foundation");
  // CGWindowListCopyWindowInfo returns a CFArrayRef; castRefToObject bridges it
  // to a usable NSArray (CFBridgingRelease is inlined and segfaults from JXA).
  var list = ObjC.castRefToObject(
      $.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, 0));
  var ids = [];
  for (var i = 0; i < list.count; i++) {
      var entry = list.objectAtIndex(i);
      var owner = ObjC.unwrap(entry.objectForKey("kCGWindowOwnerName"));
      if (owner !== "iTerm2" && owner !== "Ghostty") { continue; }
      if (ObjC.unwrap(entry.objectForKey("kCGWindowLayer")) !== 0) { continue; }
      ids.push(ObjC.unwrap(entry.objectForKey("kCGWindowNumber")));
  }
  ids.join("\n");
]]

local function stackedTerminalIds(callback)
  task({"osascript", "-l", "JavaScript", "-e", STACKED_IDS_JS}, function (ok, output)
    local ids = {}
    if ok and output then
      for id in output:gmatch("%d+") do
        table.insert(ids, tonumber(id))
      end
    end
    callback(ids)
  end)
end

local function focusWindowId(id)
  task({"wm-preset", "focus-window-id", tostring(id)})
end

-- Iterate iTerm + Ghostty windows as if they were a single app -- the
-- cross-terminal counterpart to ghosttyPreset.iterateWindows, which can only see
-- its own app's windows. Windows from both apps are merged and ordered by id.
-- When a terminal window is focused, step to the next merged window (wrapping,
-- possibly crossing into the other app); otherwise raise the frontmost terminal
-- window. Iterating only: when there is no terminal window at all this no-ops,
-- and the caller decides whether to launch one.
--
-- opts.exceptId (number, or string as passed by the shim; "" means none) is the
-- window to skip -- the devserver. opts.prev (bool) walks backwards.
function M.iterateWindows(opts)
  opts = opts or {}
  local exceptId = tonumber(opts.exceptId)
  local prev = opts.prev and true or false

  -- print_stdout = false: the query is ~11KB of JSON, and shell.task debug-logs
  -- every task's stdout -- which would dump all of it into the Hammerspoon
  -- console on each keypress. The trace line and stderr are still logged.
  task({"yabai", "-m", "query", "--windows", print_stdout = false}, function (ok, output)
    if not ok or not output or output == "" then return end

    local queried = hs.json.decode(output)
    if not queried then return end

    -- One pass for both "which windows" and "which is focused". Sticky windows
    -- (the floating/quick terminals) sit outside the cycle.
    local windows, focusedId = {}, nil
    for _, w in ipairs(queried) do
      if w["has-focus"] then focusedId = w.id end
      if TERMINAL_APPS[w.app] and not w["is-sticky"] and w.id ~= exceptId then
        table.insert(windows, w.id)
      end
    end

    if #windows == 0 then return end
    table.sort(windows)

    local pos = nil
    for i, id in ipairs(windows) do
      if id == focusedId then
        pos = i
        break
      end
    end

    if pos then
      -- On a terminal window: step to the next (wrapping). Lua's % is floored,
      -- so the backwards case wraps to the end without extra arithmetic.
      local target = prev and windows[((pos - 2) % #windows) + 1]
        or windows[(pos % #windows) + 1]
      log("iterate to " .. tostring(target))
      focusWindowId(target)
      return
    end

    -- Elsewhere: raise the frontmost eligible window, falling back to the lowest
    -- id when none of the candidates is on the current space.
    local eligible = {}
    for _, id in ipairs(windows) do eligible[id] = true end

    stackedTerminalIds(function (stacked)
      for _, id in ipairs(stacked) do
        if eligible[id] then
          log("raise frontmost " .. tostring(id))
          focusWindowId(id)
          return
        end
      end
      log("raise fallback " .. tostring(windows[1]))
      focusWindowId(windows[1])
    end)
  end)
end

return M
