-- Ghostty control logic, ported from the `ghostty-preset` fish script so it can
-- run IN-PROCESS inside Hammerspoon. The keybindings call these functions
-- directly (no `task`, no `hs -c`), which is what fixes the per-keystroke race:
-- the old path fired multiple `hs -c` calls per press (one for a predicate, one
-- for send-keys) and the `hs` CLI's mach-port creation collides when calls land
-- back-to-back or overlap under fast presses. In-process calls are plain
-- function calls on Hammerspoon's single event loop -- serialized, nothing to
-- collide.
--
-- `bin/ghostty-preset` is now a thin shim that dispatches each subcommand to the
-- matching function here via a single `hs -c`, so external CLI callers
-- (term-preset, meta-preset, herdr-preset) keep working against one
-- implementation. The only logic left in the shim is nvim-tab-remote /
-- nvim-open-in-tab, which need the caller's shell env ($NVIM/$TMUX/cwd) and
-- tools (nvim --server, tmux, lsof) and so can't live in Hammerspoon.
--
-- AppleScript-backed predicates/actions run via hs.osascript.applescript (in
-- process). AX-backed predicates delegate to preset.lua. Keystrokes go through
-- Preset.sendKeys, which is immune to the physically-held hyper modifiers.

local Preset = require("preset")

local GHOSTTY = 'application id "com.mitchellh.ghostty"'

local M = {}

-- Simple trace: which ghosttyPreset action a keybinding just invoked.
local function log(msg)
  print("[ghosttyPreset] " .. msg)
end

-- Send a chord via Preset.sendKeys, which replicates `osascript-preset send-keys`
-- exactly (null-source CGEventCreateKeyboardEvent + CGEventSetFlags +
-- CGEventPost) but run in-process through hs.osascript.javascript -- no
-- subprocess, no `hs -c`. This is the mechanism we're testing. (The `app`
-- argument is passed for reference but currently unused by Preset.sendKeys.)
local function sendToFocused(chord)
  local win = hs.window.focusedWindow()
  Preset.sendKeys(chord, win and win:application() or nil)
end

-- Herdr/nvim chords go through Preset.sendKeys, which pre-releases the key to
-- dodge the trigger-key/synth-key collision (a hyper binding like ctrl+cmd+h
-- holds the physical h while we synthesize h). Kept as a named alias for the
-- herdr-input branches to document intent.
local function sendKeyToTerminal(chord)
  return Preset.sendKeys(chord)
end

-- Run an AppleScript snippet, returning (ok, result). Blocks the event loop, so
-- keep the scripts tiny; the AX predicates below avoid AppleScript entirely.
local function runAS(script)
  local ok, result = hs.osascript.applescript(script)
  return ok, result
end

-- Escape a Lua string for embedding inside an AppleScript double-quoted literal.
local function escapeAS(s)
  return (s:gsub("\\", "\\\\"):gsub('"', '\\"'))
end

-- mosh prepends "[mosh] " to the terminal title while connected; strip it before
-- matching the program name. Mirrors the fish/preset.lua title logic.
local function withoutMoshPrefix(title)
  return (title:gsub("^%[mosh%] ", ""))
end

-- The program doesn't always own the title: mosh may prefix it ("[mosh] ..."),
-- dev-preset --herdr-server writes "exec env zsh -c herdr", the connect command
-- shows up as "dev connect --mosh - ...", etc. Rather than anchor to the start
-- or a word boundary, accept the program name appearing anywhere in the title.
local function titleRuns(title, program)
  title = withoutMoshPrefix(title or "")
  return title:find(program, 1, true) ~= nil
end

-- Name of the sole terminal when the front window is exactly one tab with
-- exactly one pane; "" otherwise (including AppleScript error). `count of
-- terminals` counts logical splits, so a zoomed multi-split reports >1 and is
-- excluded -- matching __ghostty_is_herdr_window / __ghostty_is_multiplexer_window.
local function loneSurfaceName()
  local ok, name = runAS([[
    tell ]] .. GHOSTTY .. [[

      try
        set win to front window
        if (count of tabs of win) is not 1 then return ""
        set tb to item 1 of tabs of win
        if (count of terminals of tb) is not 1 then return ""
        return name of item 1 of terminals of tb
      end try
      return ""
    end tell
  ]])
  if ok and type(name) == "string" then return name end
  return ""
end

---------------------------------------------------------------
-- Predicates
---------------------------------------------------------------

-- Exactly one visible surface (zoomed split OR a genuine single pane). Pure AX.
function M.isZoomedOrSingleSurface()
  return Preset.isGhosttyZoomedOrSingleSurface()
end

-- A split is zoomed: one visible surface AND the active tab still has >1 logical
-- split. The logical-split count needs AppleScript.
function M.isZoomed()
  if not M.isZoomedOrSingleSurface() then return false end
  local ok, n = runAS("tell " .. GHOSTTY ..
    " to count of terminals of selected tab of front window")
  return ok and type(n) == "number" and n > 1
end

-- The quick (floating) terminal is the focused window. Pure AX.
function M.isFloatingTerminal()
  return Preset.isGhosttyQuickTerminalActive()
end

-- Front window is a lone herdr session (one tab, one pane, title runs herdr).
function M.isHerdrWindow()
  local name = loneSurfaceName()
  return name ~= "" and titleRuns(name, "herdr")
end

-- Front window is a lone multiplexer session (one tab, one pane, title nvim or
-- herdr). The quick terminal can't be addressed via `front window`, so answer it
-- from AX instead.
function M.isMultiplexerWindow()
  if M.isFloatingTerminal() then
    return M.isMultiplexerAppZoomedOrSingleSurface()
  end
  local name = loneSurfaceName()
  return name ~= "" and (titleRuns(name, "herdr") or titleRuns(name, "nvim"))
end

-- Single surface (zoomed split or lone pane) running herdr. Pure AX.
function M.isHerdrZoomedOrSingleSurface()
  return Preset.isGhosttyHerdrZoomedOrSingleSurface()
end

-- Single surface (zoomed split or lone pane) running nvim or herdr. Pure AX.
function M.isMultiplexerAppZoomedOrSingleSurface()
  return Preset.isGhosttyMultiplexerZoomedOrSingleSurface()
end

---------------------------------------------------------------
-- Window / tab / split actions
---------------------------------------------------------------

function M.newWindow()
  log("newWindow")
  runAS("tell " .. GHOSTTY .. " to new window")
end

function M.newTab()
  runAS("tell " .. GHOSTTY .. " to new tab in front window")
end

-- Create a split. opts.vertical selects a left/right divider (Ghostty `direction
-- right`); otherwise top/bottom (`direction down`). opts.cmd, if set, bakes a
-- command into the new surface with the same success/error semantics as
-- iterm-preset new-split -c: on success the split closes cleanly (we close it
-- ourselves via AppleScript so Ghostty's abnormal-exit box never fires); on
-- error it stays open showing the output until Enter. See the fish original for
-- the full rationale.
function M.newSplit(opts)
  opts = opts or {}
  local direction = opts.vertical and "right" or "down"

  if opts.cmd and opts.cmd ~= "" then
    local closeCmd = "osascript -e 'tell " .. GHOSTTY ..
      " to close (focused terminal of selected tab of front window)'"
    local inner = opts.cmd .. "; and " .. closeCmd ..
      "; or read -P 'Press Enter to close'"
    -- Ghostty runs `command` via /bin/sh -c, so wrap the fish invocation in
    -- single quotes, escaping embedded single quotes the POSIX way.
    local sq = inner:gsub("'", "'\\''")
    local commandValue = "fish -c '" .. sq .. "'"

    runAS(string.format([[
      tell ]] .. GHOSTTY .. [[

        split (focused terminal of selected tab of front window) direction %s with configuration {command:"%s", wait after command:false}
      end tell
    ]], direction, escapeAS(commandValue)))
  else
    runAS("tell " .. GHOSTTY ..
      " to split (focused terminal of selected tab of front window) direction " .. direction)
  end
end

---------------------------------------------------------------
-- Fallback actions (multiplexer-aware). These are the keystroke-driven paths;
-- the chords all hold ctrl (or cmd+ctrl) so the eventtap that invokes them
-- ignores their output -- no re-entry.
---------------------------------------------------------------

-- horizontal=true -> top/bottom divider, false -> left/right. Mirrors the
-- keybinding call `new-split-with-fallback (shift ? --horizontal : --vertical)`.
function M.newSplitWithFallback(horizontal)
  log("newSplitWithFallback " .. (horizontal and "horizontal" or "vertical"))
  if M.isMultiplexerAppZoomedOrSingleSurface() then
    sendKeyToTerminal(horizontal and {"ctrl", "alt", "shift", "d"} or {"ctrl", "alt", "d"})
  elseif M.isFloatingTerminal() then
    sendToFocused(horizontal and {"cmd", "ctrl", "shift", "d"} or {"ctrl", "shift", "d"})
  else
    M.newSplit({ vertical = not horizontal })
  end
end

function M.newTabWithFallback()
  log("newTabWithFallback")
  if M.isMultiplexerWindow() then
    sendKeyToTerminal({"ctrl", "alt", "t"})
  elseif M.isFloatingTerminal() then
    sendToFocused({"cmd", "ctrl", "t"})
  else
    M.newTab()
  end
end

function M.newWindowWithFallback()
  log("newWindowWithFallback")
  if M.isMultiplexerWindow() then
    sendKeyToTerminal({"ctrl", "alt", "n"})
  elseif M.isFloatingTerminal() then
    sendToFocused({"cmd", "ctrl", "n"})
  else
    M.newWindow()
  end
end

-- direction: "prev"/"previous" or "next".
function M.focusTabWithFallback(direction)
  local fallbackKey
  if direction == "prev" or direction == "previous" then
    fallbackKey = "leftbracket"
  elseif direction == "next" then
    fallbackKey = "rightbracket"
  else
    return false
  end
  log("focusTabWithFallback " .. direction)

  if M.isMultiplexerWindow() then
    sendKeyToTerminal({"ctrl", "alt", "shift", fallbackKey})
  elseif fallbackKey == "leftbracket" then
    sendToFocused({"ctrl", "shift", "tab"})
  else
    sendToFocused({"ctrl", "tab"})
  end
  return true
end

function M.closePaneWithFallback()
  log("closePaneWithFallback")
  if M.isMultiplexerAppZoomedOrSingleSurface() then
    sendKeyToTerminal({"ctrl", "alt", "w"})
  else
    sendToFocused({"cmd", "ctrl", "w"})
  end
end

-- direction: "left"/"right"/"up"/"down".
function M.focusPaneWithFallback(direction)
  local fallbackKey = ({ left = "h", right = "l", down = "j", up = "k" })[direction]
  if not fallbackKey then return false end
  log("focusPaneWithFallback " .. direction)
  if M.isMultiplexerAppZoomedOrSingleSurface() then
    sendKeyToTerminal({"ctrl", "alt", fallbackKey})
  else
    sendToFocused({"cmd", "alt", direction})
  end
  return true
end

-- Show the quick terminal if it isn't already focused (F17 toggles it globally).
function M.revealFloatingTerminal()
  log("revealFloatingTerminal")
  if not M.isFloatingTerminal() then
    Preset.sendKeys({"f17"})
  end
end

-- Hide the quick terminal if it is currently focused.
function M.hideFloatingTerminal()
  if M.isFloatingTerminal() then
    Preset.sendKeys({"f17"})
  end
end

---------------------------------------------------------------
-- Window cycling
---------------------------------------------------------------

-- Cycle Ghostty windows, skipping one by id (the devserver window). When Ghostty
-- is already frontmost, advance to the next eligible window (wrapping); otherwise
-- bring the most recent eligible window forward. Ordered by id for predictable
-- cycling. opts.exceptId (string, may be "") and opts.prev (bool).
function M.iterateWindows(opts)
  opts = opts or {}
  local exceptId = tostring(opts.exceptId or "")
  local wantPrev = opts.prev and "true" or "false"

  runAS(string.format([[
    set exceptId to "%s"
    set wantPrev to %s
    tell ]] .. GHOSTTY .. [[

      set ids to {}
      repeat with w in windows
        set wid to id of w
        if (wid as text) is not exceptId then set end of ids to wid
      end repeat
      if (count of ids) is 0 then
        activate
        return
      end if
      set recentId to item 1 of ids
      set n to count of ids
      repeat with i from 1 to n - 1
        repeat with j from 1 to (n - i)
          if (item j of ids) > (item (j + 1) of ids) then
            set tmp to item j of ids
            set item j of ids to item (j + 1) of ids
            set item (j + 1) of ids to tmp
          end if
        end repeat
      end repeat
      set isFront to frontmost
      set curId to missing value
      try
        set curId to id of front window
      end try
      set pos to 0
      repeat with i from 1 to n
        if (item i of ids) is curId then
          set pos to i
          exit repeat
        end if
      end repeat
      if isFront and pos > 0 then
        if wantPrev then
          set targetPos to ((pos - 2 + n) mod n) + 1
        else
          set targetPos to (pos mod n) + 1
        end if
        set targetId to item targetPos of ids
      else if pos > 0 then
        set targetId to item pos of ids
      else
        set targetId to recentId
      end if
      activate
      repeat with w in windows
        if id of w is targetId then
          activate window w
          exit repeat
        end if
      end repeat
    end tell
  ]], escapeAS(exceptId), wantPrev))
end

---------------------------------------------------------------
-- Open file (herdr-aware)
---------------------------------------------------------------

-- Open <file> split off the focused surface. When herdr owns the surface, a
-- native Ghostty split would make a pane herdr can't manage, so drive herdr's
-- run-command prompt (ctrl+alt+shift+semicolon -> run-command.sh popup): open
-- it, type the herdr-preset invocation, then Enter. run-command.sh evals it in
-- the popup (which has HERDR_* env), so herdr-preset targets the right tab. No
-- `exec` -- the popup closes when herdr-preset returns 0. Anywhere else, a
-- native Ghostty split driving nvim-open-in-tab (implemented in the fish shim).
function M.openFileWithFallback(file)
  if not file or file == "" then return false end
  log("openFileWithFallback " .. file)
  if M.isHerdrZoomedOrSingleSurface() then
    -- Put the command on the clipboard and paste it in one shot rather than
    -- typing it: per-character keystroke synthesis was triggering a keyboard
    -- sound (klack) on every letter. Single-quote the path for the popup's bash
    -- `eval`. Restore the previous clipboard once the paste has been consumed.
    local cmd = "herdr-preset open-file-with-fallback '" .. file:gsub("'", "'\\''") .. "'"
    local saved = hs.pasteboard.getContents()
    hs.pasteboard.setContents(cmd)
    Preset.sendKeys({"ctrl", "alt", "shift", "semicolon"})
    hs.timer.doAfter(0.25, function()
      Preset.sendKeys({"cmd", "v"})
      hs.timer.doAfter(0.08, function()
        Preset.sendKeys({"return"})
        hs.timer.doAfter(0.15, function()
          if saved ~= nil then
            hs.pasteboard.setContents(saved)
          else
            hs.pasteboard.clearContents()
          end
        end)
      end)
    end)
  else
    M.newSplit({ vertical = true, cmd = 'ghostty-preset nvim-open-in-tab "' .. file .. '"' })
  end
  return true
end

return M
