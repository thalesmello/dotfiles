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
-- spaces iterm-preset and ghostty-preset use -- and the one subprocess it needs
-- runs through shell.task, off the event loop.
--
-- That subprocess is `yabai-preset list-windows`, which already applies the
-- visible/non-sticky filter every window-cycling caller wants and emits the
-- windows in yabai's query order -- front-to-back stacking order, since yabai
-- builds its table from CGWindowList. So one call answers membership, focus and
-- z-order. An earlier version shelled out to a second process (`osascript -l
-- JavaScript` over CGWindowListCopyWindowInfo) purely to learn the z-order for
-- the "raise the frontmost terminal" fallback: ~65ms of osascript startup for
-- an ordering the window list already carried.

local Preset = require("preset")
local GhosttyPreset = require("ghosttyPreset")
local task = require("shell").task

local M = {}

-- Matched against yabai's `.app` by `list-windows --app`, so the two terminals
-- are merged into one cycle.
local TERMINAL_APP_REGEX = "^(iTerm2|Ghostty)$"

-- Simple trace: which termPreset action a keybinding just invoked.
local function log(msg)
  print("[termPreset] " .. msg)
end

-- Compact one-line rendering of a window list: `id(title)` in the given order,
-- with `*` marking the window that currently has focus. Titles are truncated --
-- this is for eyeballing which window is which in the console, not for parsing.
-- Every log line is a single-argument print of a concatenated string, so a
-- stray multi-line or `table: 0x...` entry came from some other module.
local function describe(ids, titles, focusedId)
  local parts = {}
  for _, id in ipairs(ids) do
    local title = titles and titles[id] or nil
    if title and #title > 28 then title = title:sub(1, 27) .. "…" end
    parts[#parts + 1] = tostring(id)
      .. (id == focusedId and "*" or "")
      .. (title and ("(" .. title .. ")") or "")
  end
  if #parts == 0 then return "(empty)" end
  return table.concat(parts, " ")
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

local function focusWindowId(id)
  task({"wm-preset", "focus-window-id", tostring(id)})
end

-- Per-press counter. Each press is an async task, so two fast presses interleave
-- their callbacks in the console; the `#N` tag keeps one press's lines together.
local pressSeq = 0

-- Iterate iTerm + Ghostty windows as if they were a single app -- the
-- cross-terminal counterpart to ghosttyPreset.iterateWindows, which can only see
-- its own app's windows. Windows from both apps are merged and ordered by id.
-- When a terminal window is focused, step to the next merged window (wrapping,
-- possibly crossing into the other app); otherwise raise the frontmost terminal
-- window. Iterating only: when there is no terminal window at all this no-ops,
-- and the caller decides whether to launch one.
--
-- The cycle covers the visible windows -- `list-windows` filters to those, so a
-- terminal parked on another space is not part of the rotation.
--
-- opts.exceptId (number, or string as passed by the shim; "" means none) is the
-- window to skip -- the devserver. opts.prev (bool) walks backwards.
function M.iterateWindows(opts)
  opts = opts or {}
  local exceptId = tonumber(opts.exceptId)
  local prev = opts.prev and true or false

  pressSeq = pressSeq + 1
  local seq = pressSeq
  local tag = "#" .. seq .. " "
  log(tag .. "press: exceptId=" .. tostring(exceptId)
    .. " (raw " .. tostring(opts.exceptId) .. ", " .. type(opts.exceptId) .. ")"
    .. " direction=" .. (prev and "prev" or "next"))

  local args = {"yabai-preset", "list-windows", "--app", TERMINAL_APP_REGEX,
    -- print_stdout = false: shell.task debug-logs every task's stdout, and these
    -- are whole yabai window objects -- kilobytes of JSON in the Hammerspoon
    -- console on each keypress. The trace line and stderr are still logged.
    print_stdout = false}
  if exceptId then
    table.insert(args, "--except-id")
    table.insert(args, tostring(exceptId))
  end

  task(args, function (ok, output)
    -- `list-windows` pipes through `jq -e`, so "nothing left after filtering"
    -- arrives as a non-zero exit -- no terminal visible, or the devserver was
    -- the only one. Nothing to iterate: no-op and let the caller's next rule
    -- (launch Ghostty) decide.
    if not ok or not output or output == "" then
      log(tag .. "list-windows returned nothing (ok=" .. tostring(ok)
        .. ") -- no visible terminal, or the devserver was the only one."
        .. " Nothing to iterate.")
      return
    end

    -- One object per line, already filtered to visible non-sticky terminals
    -- minus the excluded id, and already in most-recently-used order. So
    -- `stacked` is just the lines in order -- MRU, which is what the fallback
    -- below wants -- and `windows` is the same set sorted by id, the cycle
    -- order, which has to be stable: MRU changes every time we focus something,
    -- so cycling by it would only bounce between two windows.
    local stacked, focusedId = {}, nil
    local titles, skipped = {}, 0
    for line in output:gmatch("[^\n]+") do
      local w = hs.json.decode(line)
      if w and w.id then
        if w["has-focus"] then focusedId = w.id end
        titles[w.id] = w.title
        table.insert(stacked, w.id)
      else
        -- A line that failed to decode would silently shrink the cycle, so
        -- count it rather than let it vanish.
        skipped = skipped + 1
      end
    end

    if skipped > 0 then
      log(tag .. "WARNING " .. skipped .. " list-windows line(s) failed to decode")
    end

    if #stacked == 0 then
      log(tag .. "no windows survived decode -- nothing to iterate")
      return
    end

    local windows = {table.unpack(stacked)}
    table.sort(windows)

    local pos = nil
    for i, id in ipairs(windows) do
      if id == focusedId then
        pos = i
        break
      end
    end

    -- The three things needed to explain any iteration decision: what the
    -- rotation contains, in both orders, and where the focused window sits in
    -- it. A rotation of one is the signature of a cycle that cannot advance.
    log(tag .. "list (mru order)  " .. describe(stacked, titles, focusedId))
    log(tag .. "cycle (by id)     " .. describe(windows, nil, focusedId))
    log(tag .. "current=" .. tostring(focusedId)
      .. " pos=" .. tostring(pos) .. " of " .. #windows
      .. (focusedId == nil
        and "  <- focused window is NOT in the list (excluded devserver, not a"
            .. " terminal, or filtered out as not visible)"
        or (#windows == 1
          and "  <- rotation has ONE window; next/prev can only return itself"
          or "")))

    if pos then
      -- On a terminal window: step to the next (wrapping). Lua's % is floored,
      -- so the backwards case wraps to the end without extra arithmetic.
      local target = prev and windows[((pos - 2) % #windows) + 1]
        or windows[(pos % #windows) + 1]
      local targetPos = prev and ((pos - 2) % #windows) + 1
        or (pos % #windows) + 1
      log(tag .. "cycle branch: pos " .. pos .. (prev and " -1 -> " or " +1 -> ")
        .. targetPos .. " -> target " .. tostring(target)
        .. " (" .. tostring(titles[target]) .. ")"
        .. (target == focusedId and "  <- SAME AS CURRENT, focus will not move" or ""))
      log("iterate to " .. tostring(target))
      focusWindowId(target)
      return
    end

    -- Elsewhere (Chrome, or the excluded devserver window): raise the most
    -- recently used terminal, which is the head of the list. Every candidate is
    -- visible, so there is always one -- the old lowest-id fallback only existed
    -- for the case where the stacking query saw the current space and the
    -- window list didn't.
    log(tag .. "fallback branch: most recent of list -> target "
      .. tostring(stacked[1]) .. " (" .. tostring(titles[stacked[1]]) .. ")")
    log("raise frontmost " .. tostring(stacked[1]))
    focusWindowId(stacked[1])
  end)
end

return M
