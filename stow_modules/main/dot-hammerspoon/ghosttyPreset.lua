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

-- True when the focused surface is a mosh session: mosh prepends "[mosh] " to
-- the terminal title, so the word appears anywhere in the title. Over mosh the
-- remote multiplexer (nvim/herdr) only binds the ctrl+space *prefix* sequences,
-- not the direct ctrl+alt chords the local multiplexer uses -- so the fallbacks
-- below switch to prefix+key when this is true. Only consulted inside a branch
-- that has already confirmed the multiplexer predicate.
local function isMoshMode()
  local win = hs.window.focusedWindow()
  local title = win and win:title() or ""
  return title:find("mosh", 1, true) ~= nil
end

-- Send the multiplexer prefix (ctrl+space) then a follow-up chord. This is the
-- original pre-"direct mappings" sequence, kept for mosh mode where the remote
-- multiplexer binds the prefix rather than the local direct ctrl+alt chords.
local function sendPrefixThen(chord)
  sendKeyToTerminal({"ctrl", "space"})
  sendKeyToTerminal(chord)
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

-- Transport markers lead the terminal title: mosh prepends "[mosh] " while
-- connected, and dev-preset writes "[et] " for its Eternal Terminal mode. Strip
-- either before matching the program name. Mirrors the preset.lua title logic.
local function withoutTransportPrefix(title)
  return (title:gsub("^%[mosh%] ", ""):gsub("^%[et%] ", ""))
end

-- The program doesn't always own the title: mosh may prefix it ("[mosh] ..."),
-- dev-preset --herdr-server writes "exec env zsh -c herdr", the connect command
-- shows up as "dev connect --mosh - ...", etc. Rather than anchor to the start
-- or a word boundary, accept the program name appearing anywhere in the title.
local function titleRuns(title, program)
  title = withoutTransportPrefix(title or "")
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
    if isMoshMode() then
      -- Old prefix sequence: prefix, then `-` (horizontal) or `v` (vertical).
      log("  -> route: multiplexer (mosh prefix)")
      sendPrefixThen(horizontal and {"minus"} or {"v"})
    else
      log("  -> route: multiplexer (direct ctrl+alt)")
      sendKeyToTerminal(horizontal and {"ctrl", "alt", "shift", "d"} or {"ctrl", "alt", "d"})
    end
  elseif M.isFloatingTerminal() then
    log("  -> route: floating terminal")
    sendToFocused(horizontal and {"cmd", "ctrl", "shift", "d"} or {"ctrl", "shift", "d"})
  else
    log("  -> route: native Ghostty split")
    M.newSplit({ vertical = not horizontal })
  end
end

function M.newTabWithFallback()
  log("newTabWithFallback")
  if M.isMultiplexerWindow() then
    if isMoshMode() then
      log("  -> route: multiplexer (mosh prefix)")
      sendPrefixThen({"ctrl", "t"})
    else
      log("  -> route: multiplexer (direct ctrl+alt)")
      sendKeyToTerminal({"ctrl", "alt", "t"})
    end
  elseif M.isFloatingTerminal() then
    log("  -> route: floating terminal")
    sendToFocused({"cmd", "ctrl", "t"})
  else
    log("  -> route: native Ghostty tab")
    M.newTab()
  end
end

function M.newWindowWithFallback()
  log("newWindowWithFallback")
  if M.isMultiplexerWindow() then
    if isMoshMode() then
      -- Old prefix sequence for new-window was prefix, then shift+n.
      log("  -> route: multiplexer (mosh prefix)")
      sendPrefixThen({"shift", "n"})
    else
      log("  -> route: multiplexer (direct ctrl+alt)")
      sendKeyToTerminal({"ctrl", "alt", "n"})
    end
  elseif M.isFloatingTerminal() then
    log("  -> route: floating terminal")
    sendToFocused({"cmd", "ctrl", "n"})
  else
    log("  -> route: native Ghostty window")
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
    if isMoshMode() then
      -- Prefix sequence: prefix, then [ (prev) / ] (next).
      log("  -> route: multiplexer (mosh prefix)")
      sendPrefixThen({fallbackKey})
    else
      log("  -> route: multiplexer (direct ctrl+alt)")
      sendKeyToTerminal({"ctrl", "alt", "shift", fallbackKey})
    end
  elseif fallbackKey == "leftbracket" then
    log("  -> route: focused window (ctrl+shift+tab)")
    sendToFocused({"ctrl", "shift", "tab"})
  else
    log("  -> route: focused window (ctrl+tab)")
    sendToFocused({"ctrl", "tab"})
  end
  return true
end

-- Focus TAB `index` (1-9) inside a multiplexer surface via the prefix sequence:
-- prefix, then N. That's herdr's focus-tab binding, mirrored by nvim's
-- <c-space>N tab mapping, so the same sequence works in either multiplexer and
-- both locally and over mosh (where only the prefix sequences are bound
-- remotely).
-- Returns false when this isn't a multiplexer surface, so the caller can let
-- cmd+N fall through to Ghostty's own goto_tab / to the frontmost app.
function M.focusTabIndexWithFallback(index)
  if type(index) ~= "number" or index < 1 or index > 9 then return false end
  if not M.isMultiplexerWindow() then
    log("focusTabIndexWithFallback " .. index .. " -> route: not a multiplexer, passing through")
    return false
  end
  log("focusTabIndexWithFallback " .. index .. " -> route: multiplexer (prefix + " .. index .. ")")
  sendPrefixThen({tostring(index)})
  return true
end

-- Focus WORKSPACE `index` (1-9) inside a multiplexer surface: prefix, then w,
-- then N -- herdr's workspace picker, mirrored by nvim's <c-space>wN mapping.
-- Always the prefix sequence, local or over mosh.
-- Returns false when this isn't a multiplexer surface, so the caller can let
-- cmd+ctrl+N fall through to Ghostty / the frontmost app.
function M.focusWorkspaceIndexWithFallback(index)
  if type(index) ~= "number" or index < 1 or index > 9 then return false end
  if not M.isMultiplexerWindow() then
    log("focusWorkspaceIndexWithFallback " .. index .. " -> route: not a multiplexer, passing through")
    return false
  end
  log("focusWorkspaceIndexWithFallback " .. index .. " -> route: multiplexer (prefix + w + " .. index .. ")")
  sendPrefixThen({"w"})
  sendKeyToTerminal({tostring(index)})
  return true
end

-- Toggle herdr's sidebar (prefix+b) when herdr owns the visible surface.
-- Returns false otherwise so the caller can let cmd+b through untouched.
function M.toggleSidebarWithFallback()
  if not M.isHerdrZoomedOrSingleSurface() then
    log("toggleSidebarWithFallback -> route: not herdr, passing through")
    return false
  end
  log("toggleSidebarWithFallback -> route: herdr (prefix+b)")
  sendPrefixThen({"b"})
  return true
end

-- Toggle herdr's pane zoom (prefix+ctrl+enter) when the front window is a herdr
-- session. Deliberately isHerdrWindow (not the zoomed-or-single-surface variant):
-- zoom has to stay reachable to *un*zoom, and it's equally valid with several
-- visible splits. Returns false otherwise so the caller can let cmd+shift+enter
-- through untouched.
function M.zoomWithFallback()
  if not M.isHerdrWindow() then
    log("zoomWithFallback -> route: not herdr, passing through")
    return false
  end
  -- Always the prefix sequence, local or over mosh: zoom has no direct chord.
  log("zoomWithFallback -> route: herdr (prefix+ctrl+enter)")
  sendPrefixThen({"ctrl", "return"})
  return true
end

-- Resize the focused herdr split one step in `direction` ("left"/"right"/"up"/
-- "down"). herdr has no one-shot resize binding, only a resize MODE (prefix+r,
-- then h/l for width and j/k for height, esc to leave), so one press is the
-- whole round trip: prefix+r, the direction key, esc. Staying in the mode isn't
-- an option here -- the caller is a plain macOS chord, and leaving herdr in
-- resize mode would swallow the next keystrokes typed into the pane.
--
-- Same isHerdrWindow predicate as zoomWithFallback, and for the same reason:
-- resizing is only meaningful with several visible splits, which the
-- zoomed-or-single-surface variants exclude.
--
-- Anywhere else in Ghostty, fall through to ctrl+cmd+<arrow>, which its config
-- maps to resize_split.
function M.resizePaneWithFallback(direction)
  local key = ({ left = "h", right = "l", down = "j", up = "k" })[direction]
  if not key then return false end
  log("resizePaneWithFallback " .. direction)

  if M.isHerdrWindow() then
    -- Always the prefix sequence, local or over mosh: resize mode has no direct
    -- chord.
    log("  -> route: herdr (prefix+r, " .. key .. ", esc)")
    sendPrefixThen({"r"})
    sendKeyToTerminal({key})
    sendKeyToTerminal({"escape"})
  else
    log("  -> route: focused window (ctrl+cmd+" .. direction .. ")")
    sendToFocused({"ctrl", "cmd", direction})
  end
  return true
end

function M.closePaneWithFallback()
  log("closePaneWithFallback")
  if M.isMultiplexerAppZoomedOrSingleSurface() then
    if isMoshMode() then
      -- Old prefix sequence for close-pane was prefix, then backspace.
      log("  -> route: multiplexer (mosh prefix)")
      sendPrefixThen({"backspace"})
    else
      log("  -> route: multiplexer (direct ctrl+alt)")
      sendKeyToTerminal({"ctrl", "alt", "w"})
    end
  else
    log("  -> route: focused window (cmd+ctrl+w)")
    sendToFocused({"cmd", "ctrl", "w"})
  end
end

-- direction: "left"/"right"/"up"/"down".
function M.focusPaneWithFallback(direction)
  local fallbackKey = ({ left = "h", right = "l", down = "j", up = "k" })[direction]
  if not fallbackKey then return false end
  log("focusPaneWithFallback " .. direction)
  if M.isMultiplexerAppZoomedOrSingleSurface() then
    if isMoshMode() then
      -- Old prefix sequence: prefix, then ctrl+<hjkl>.
      log("  -> route: multiplexer (mosh prefix)")
      sendPrefixThen({"ctrl", fallbackKey})
    else
      log("  -> route: multiplexer (direct ctrl+alt)")
      sendKeyToTerminal({"ctrl", "alt", fallbackKey})
    end
  else
    log("  -> route: focused window (cmd+alt+" .. direction .. ")")
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
-- herdr run-command popup
---------------------------------------------------------------

-- Run <cmd> in herdr's run-command prompt (ctrl+alt+shift+semicolon ->
-- run-command.sh popup) and return without waiting for it: open the popup,
-- paste, Enter. run-command.sh evals in the popup, which carries the HERDR_* env
-- of the pane that was focused, so the command targets the right pane/tab. The
-- popup closes on a zero exit and stays up showing the output otherwise.
--
-- The command travels via the clipboard, pasted rather than typed out: synthesizing
-- a chord per character made the keyboard klack on every letter. The clipboard is
-- saved and put back here, so callers never see it move.
--
-- Both delays are about that clipboard, not about the popup. The write has to be
-- visible before cmd+v, or the prompt gets the PREVIOUS clipboard; and posting
-- the paste is not the same as Ghostty having read the pasteboard, so restoring
-- on the next line is the same race in reverse -- that one is what puts a stray
-- "Command: <some path you copied earlier>" in the popup. If a slow popup ever
-- starts swallowing the chords themselves, this is where those delays go too.
-- Returns nothing on purpose: `hs -c` prints whatever the chunk evaluates to, so
-- a `true` here would show up on the shim's stdout and end up mixed into the
-- output execute-herdr-command hands back to its caller.
function M.executeAndForgetHerdrCommand(cmd)
  if not cmd or cmd == "" then return end

  local saved = hs.pasteboard.getContents()
  hs.pasteboard.setContents(cmd)

  Preset.sendKeys({"ctrl", "alt", "shift", "semicolon"})
  hs.timer.doAfter(0.05, function()
    Preset.sendKeys({"cmd", "v"})
    Preset.sendKeys({"return"})
    hs.timer.doAfter(0.15, function()
      -- Only put it back if it is still ours to put back. By now the command may
      -- have answered on the clipboard (execute-herdr-command's replies come in
      -- that way), or another run may have staged its own command there -- and
      -- restoring over either loses it.
      if hs.pasteboard.getContents() ~= cmd then return end

      if saved ~= nil then
        hs.pasteboard.setContents(saved)
      else
        hs.pasteboard.clearContents()
      end
    end)
  end)
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
    log("  -> route: herdr run-command popup")
    -- Single-quote the path for the popup's bash `eval`.
    M.executeAndForgetHerdrCommand(
      "herdr-preset open-file-with-fallback '" .. file:gsub("'", "'\\''") .. "'")
  else
    log("  -> route: native Ghostty split (nvim-open-in-tab)")
    M.newSplit({ vertical = true, cmd = 'ghostty-preset nvim-open-in-tab "' .. file .. '"' })
  end
  return true
end

return M
