local shell = require("shell")
local mode = require("mode")
local palette = require("palette")
local util = require("util")
local Preset = require("preset")
local GhosttyPreset = require("ghosttyPreset")
local a = require("async")
local ArgList = require("arglist")
local PreviewHud = require("preview_hud")
local FocusHistory = require("focushistory")

local task = shell.task
local taskAsync = shell.taskAsync
local fish = shell.fish
local fishAsync = shell.fishAsync
local sleep = shell.sleepAsync
local focusedWindowAppName = mode.focusedWindowAppName
local isiTermFloatingTerminal = Preset.isFloatingTerminalActive
-- Combined: either the iTerm hotkey window or the Ghostty quick terminal.
local isFloatingTerminal = Preset.isFloatingTerminal
local Mode = mode.Mode
local createModal = mode.createModal
local registerBinding = palette.registerBinding
local showCommandPalette = palette.showCommandPalette

-- Modifier shorthands (matching skhd's ctrl + alt + cmd)
local hyper = {"ctrl", "alt", "cmd"}
local hyperShift = {"ctrl", "alt", "cmd", "shift"}

---------------------------------------------------------------
-- Helper functions
---------------------------------------------------------------

local function launchOrFocus(appName)
  util.log("launchOrFocus:", appName)
  hs.application.launchOrFocus(appName)
end

local function isProcessRunning(name)
  return taskAsync({"pgrep", "-x", name})
end

local function isWindowFloating()
  return taskAsync({"wm-preset", "is-window-floating"})
end

local function isSpaceStack()
  return taskAsync({"yabai-preset", "is-space-stack-layout"})
end

-- Focus the window `delta` steps from the currently focused one within the
-- arglist (wrapping). Assumes the arglist is non-empty.
local function navigateArgList(delta)
  a.sync(function()
    local ok, id = a.wait(taskAsync({"yabai-preset", "get-focused-window-id"}))
    local target = ArgList.relative(ok and id or "", delta)
    if not target then return end

    local focusOk = a.wait(taskAsync({"wm-preset", "focus-window-id", target}))
    if not focusOk then return end

    local pos = ArgList.indexOf(target) or 0
    Preset.displayMessage("ArgList " .. pos .. " / " .. ArgList.count())
  end)()
end

-- Preview a yabai layout as a rectangle in the hyper-release HUD, then apply it
-- once the hyper key is let go. `previewArgs` is the yabai-preset invocation
-- (including --preview) that echoes the next layout string; `family` is "snap"
-- (floating windows) or "stack", selecting the matching convert-*-layout-to-abs
-- and apply-*-layout subcommands.
--
-- The previewed layout is stored on hud.action.layout and fed back to the next
-- press via --cur-layout, so repeated presses cycle forward through the fraction
-- stops even though the window hasn't actually moved yet (yabai would otherwise
-- keep detecting the same current layout from the unchanged window). While
-- iterating we also feed the previously previewed rectangle back via
-- --logical-abs so the convert step composes against the preview (e.g. left then
-- up -> top-left corner) instead of the still-unmoved window frame.
local function previewLayout(previewArgs, family)
  local convertCmd = "convert-" .. family .. "-layout-to-abs"
  local applyCmd   = "apply-" .. family .. "-layout"
  local hud = PreviewHud.HYPER_RELEASE
  a.sync(function()
    local prev = hud.action
    local args = previewArgs
    if prev and prev.layout then
      args = {table.unpack(previewArgs)}
      args[#args + 1] = "--cur-layout=" .. prev.layout
    end

    local ok, layout = a.wait(taskAsync(args))
    if not ok or layout == "" then return end

    local convertArgs = {"yabai-preset", convertCmd, layout}
    if prev and prev.preview then
      local p = prev.preview
      convertArgs[#convertArgs + 1] =
        string.format("--logical-abs=%d:%d:%d:%d", p.x, p.y, p.w, p.h)
    end

    local absOk, abs = a.wait(taskAsync(convertArgs))
    if not absOk then return end

    local x, y, w, h = abs:match("abs:(%-?%d+):(%-?%d+):(%-?%d+):(%-?%d+)")
    if not x then return end

    hud:enter({
      preview_type = "rectangle",
      preview = {x = tonumber(x), y = tonumber(y), w = tonumber(w), h = tonumber(h)},
      layout = layout,
      apply = function() task({"yabai-preset", applyCmd, abs}) end,
    })
  end)()
end

local M = {}

function M.setup()

  ---------------------------------------------------------------
  -- Create modes
  ---------------------------------------------------------------

  local default   = setmetatable({_prefix = ""}, Mode)
  local service   = createModal(nil, "Service: ")
  local chrome    = createModal("Chrome", "Chrome: ")
  local goto_mode = createModal("Go To", "Go To: ")
  local invoke    = createModal("Invoke", "Invoke: ")
  local resize    = createModal("Resize", "")
  local restart   = createModal("Restart", "Restart: ")
  local repin     = createModal("Repin", "Repin: ")

  -- Build the chrome-preset invocation for a web app in the given mode command.
  local function webAppArgs(cmd, profile, name, url)
    if cmd == "alternate-app" then
      return {"chrome-preset", "alternate-app", "--minimize", "--profile", profile, "--app", name, url}
    elseif cmd == "focus-or-open-url" then
      return {"chrome-preset", "focus-or-open-url", "--profile", profile, url}
    elseif cmd == "open-url" then
      return {"chrome-preset", "open-url", "--profile", profile, "--label", name, url}
    else
      error("bindWebApp: unknown chrome-preset command '" .. tostring(cmd) .. "'")
    end
  end

  -- Register a web app under `key` in both Chrome mode (focus/alternate its
  -- dedicated app window) and Go To mode (open its URL in a new tab), keeping the
  -- two modes in sync. `opts` is optional:
  --   mods    - modifier list (default {})
  --   profile - Chrome profile (default "Default")
  --   chrome  - chrome-preset command for Chrome mode (default "alternate-app")
  --   goto    - chrome-preset command for Go To mode (default "open-url")
  local function bindWebApp(key, name, url, opts)
    opts = opts or {}
    local mods = opts.mods or {}
    local profile = opts.profile or "Default"
    local chromeCmd = opts.chrome or "alternate-app"
    local gotoCmd = opts["goto"] or "open-url"

    chrome:bindOnce(mods, key, name, function() task(webAppArgs(chromeCmd, profile, name, url)) end)
    goto_mode:bindOnce(mods, key, name, function() task(webAppArgs(gotoCmd, profile, name, url)) end)
  end

  ---------------------------------------------------------------
  -- Local config
  ---------------------------------------------------------------

  local ok, localConfig = pcall(require, "local.keybindings")

  ---------------------------------------------------------------
  -- Smart Cmd+Tab
  ---------------------------------------------------------------

  require("smartcmdtab").setup(hyper)

  ---------------------------------------------------------------
  -- Hyper key (Caps Lock)
  ---------------------------------------------------------------

  require("caps_hyper").setup()

  ---------------------------------------------------------------
  -- Focus history (window + Chrome tab jumplist)
  ---------------------------------------------------------------

  FocusHistory.setup()
  -- Loopback websocket the Chrome extension connects to for tab-level history.
  -- Harmless if the extension isn't installed: Chrome just stays window-level.
  require("chromebridge").setup()

  ---------------------------------------------------------------
  -- DEFAULT MODE bindings
  ---------------------------------------------------------------

  -- Command palette
  default:bindOnce(hyperShift, ";", "Command Palette", showCommandPalette)

  ---------------------------------------------------------------
  -- Palette-only commands
  --
  -- Registered straight with the palette instead of through Mode:bindOnce, so
  -- they consume no chord: passing no shortcut makes registerBinding file them
  -- under a unique anonymous key, and showCommandPalette renders the bare name
  -- with no "(...)" suffix. For things run rarely enough that a key would be
  -- wasted on them.
  ---------------------------------------------------------------

  local function command(name, fn) registerBinding(name, fn) end

  -- Install the `hs` command-line tool. Deliberately NOT done at startup: the
  -- cliStatus+cliInstall pair cost ~116ms of a ~210ms config load, and with the
  -- default /usr/local prefix (root-owned, and not where Homebrew lives on
  -- Apple Silicon) the install failed silently and re-ran on every reload.
  command("Install Hammerspoon CLI", function()
    local ipc = require("hs.ipc")
    -- Prefer the Homebrew prefix that actually exists on this machine; fall
    -- back to hs.ipc's own default.
    local prefix = hs.fs.attributes("/opt/homebrew/bin", "mode") and "/opt/homebrew" or "/usr/local"

    if ipc.cliStatus(prefix, true) then
      Preset.displayMessage("hs CLI already installed: " .. prefix .. "/bin/hs", 2)
      return
    end

    ipc.cliInstall(prefix)
    if ipc.cliStatus(prefix, true) then
      Preset.displayMessage("Installed hs CLI: " .. prefix .. "/bin/hs", 2)
    else
      Preset.displayMessage("Failed to install hs CLI to " .. prefix .. "/bin (not writable?)", 3)
    end
  end)

  command("Quit Zoom", function() require("zoomwatcher").quitZoom() end)

  command("Focus History: Show", function() FocusHistory.showList() end)
  command("Focus History: Clear", function() FocusHistory.clear() end)

  -- Utility
  default:bindOnce(hyperShift, "m", "Deminimize Last", function() task({"wm-preset", "deminimize-last"}) end)
  default:bindOnce(hyper, "m", "Minimize", function() task({"wm-preset", "minimize"}) end)
  default:conditionalBindOnce(hyper, "return", "Toggle Fullscreen", {
    {cond = function() return Preset.hasSavedFloatingFrame() end, function() Preset.toggleFloatingFullscreen() end},
    {cond = isWindowFloating, function() Preset.toggleFloatingFullscreen() end},
    {cond = isSpaceStack, function() Preset.toggleStackFullscreen() end},
    {function() task({"wm-preset", "smart-toggle-fullscreen"}) end},
  })
  default:conditionalBindOnce(hyperShift, "return", "Cycle Centered Layout", {
    {cond = isWindowFloating, function() previewLayout({"yabai-preset", "snap-center", "--preview"}, "snap") end},
    {cond = isSpaceStack, function() previewLayout({"yabai-preset", "cycle-stack-center", "--preview"}, "stack") end},
    {function() task({"wm-preset", "unstacked-swap-largest"}) end},
  })

  -- Neovide
  default:bindOnce(hyper, "v", "Neovide Toggle", function() Preset.alternateApp("Neovide", {hide = true, cmd = "neovim-ghost trigger"}) end)
  default:bindOnce(hyper, "t", "Chrome: New Tab and Focus", function() fish('chrome-cli open -t; open -a "Google Chrome"') end)

  -- Space navigation
  default:bindOnce(hyper, "[", "Focus Space Prev", function() task({"wm-preset", "focus-space", "prev"}) end)
  default:bindOnce(hyper, "]", "Focus Space Next", function() task({"wm-preset", "focus-space", "next"}) end)

  -- Window focus HJKL, with a Ghostty pane-nav fallback (GhosttyPreset
  -- focus-pane-with-fallback) in two cases:
  --   * the Ghostty quick (floating) terminal is focused -- it's a floating panel
  --     outside yabai's layout, so intercept it first and navigate its panes;
  --   * a stack layout has no floating window to shift focus to -- focus-stack-aware
  --     exits non-zero, so fall back to Ghostty pane nav.
  -- Otherwise: stack-aware focus, then plain window / floating-window focus.
  local function focusWindowOrGhosttyPane(yabaiDir, paneDir)
    return {
      {cond = Preset.isGhosttyQuickTerminalActive,
        function() GhosttyPreset.focusPaneWithFallback(paneDir) end},
      {cond = isSpaceStack, function()
        task({"yabai-preset", "focus-stack-aware", yabaiDir}, function(ok)
          -- Only fall back to Ghostty pane nav when Ghostty is focused; otherwise
          -- there's just no window that way and we leave focus put.
          if not ok and focusedWindowAppName() == "Ghostty" then
            GhosttyPreset.focusPaneWithFallback(paneDir)
          end
        end)
      end},
      {function() fish("wm-preset focus-window " .. yabaiDir ..
        "; or wm-preset focus-floating-window " .. yabaiDir) end},
    }
  end
  default:conditionalBindOnce(hyper, "h", "Focus Window West", focusWindowOrGhosttyPane("west", "left"))
  default:conditionalBindOnce(hyper, "j", "Focus Window South", focusWindowOrGhosttyPane("south", "down"))
  default:conditionalBindOnce(hyper, "k", "Focus Window North", focusWindowOrGhosttyPane("north", "up"))
  default:conditionalBindOnce(hyper, "l", "Focus Window East", focusWindowOrGhosttyPane("east", "right"))

  -- Window swap/snap/pad HJKL
  default:conditionalBindOnce(hyperShift, "h", "Swap/Snap/Pad West", {
    {cond = isWindowFloating, function() previewLayout({"yabai-preset", "snap", "left", "--preview"}, "snap") end},
    {cond = isSpaceStack, function() previewLayout({"yabai-preset", "cycle-stack-padding", "left", "--preview"}, "stack") end},
    {function() task({"wm-preset", "swap-window", "west"}) end},
  })
  default:conditionalBindOnce(hyperShift, "j", "Swap/Snap/Pad South", {
    {cond = isWindowFloating, function() previewLayout({"yabai-preset", "snap", "down", "--preview"}, "snap") end},
    {cond = isSpaceStack, function() previewLayout({"yabai-preset", "cycle-stack-padding", "down", "--preview"}, "stack") end},
    {function() task({"wm-preset", "swap-window", "south"}) end},
  })
  default:conditionalBindOnce(hyperShift, "k", "Swap/Snap/Pad North", {
    {cond = isWindowFloating, function() previewLayout({"yabai-preset", "snap", "up", "--preview"}, "snap") end},
    {cond = isSpaceStack, function() previewLayout({"yabai-preset", "cycle-stack-padding", "up", "--preview"}, "stack") end},
    {function() task({"wm-preset", "swap-window", "north"}) end},
  })
  default:conditionalBindOnce(hyperShift, "l", "Swap/Snap/Pad East", {
    {cond = isWindowFloating, function() previewLayout({"yabai-preset", "snap", "right", "--preview"}, "snap") end},
    {cond = isSpaceStack, function() previewLayout({"yabai-preset", "cycle-stack-padding", "right", "--preview"}, "stack") end},
    {function() task({"wm-preset", "swap-window", "east"}) end},
  })

  -- Ctrl+Cmd HJKL (per-app, Chrome tab nav)
  local function isiTerm()
    return isiTermFloatingTerminal() or focusedWindowAppName() == "iTerm2"
  end

  -- True when Ghostty is frontmost, OR its quick (floating) terminal is focused.
  -- focusedWindowAppName() doesn't see the floating panel as a focused window, so OR in
  -- the quick-terminal check -- mirrors isiTerm()'s isFloatingTerminalActive() OR.
  local function isGhostty()
    return focusedWindowAppName() == "Ghostty" or Preset.isGhosttyQuickTerminalActive()
  end

  -- Floating terminal shortcuts
  default:bindOnce(hyper, "/", "Toggle Ghostty Quick Terminal", function()
    hs.eventtap.keyStroke({}, "f17")
  end)

  service:bindOnce(hyper, "/", "Toggle iTerm Floating Termianl", function()
    hs.eventtap.keyStroke({}, "f20")
  end)
  -- cmd+d / cmd+shift+d / cmd+t / cmd+n / cmd+w / cmd+shift+[ / cmd+shift+] /
  -- cmd+shift+enter in Ghostty -> herdr-aware split/tab/close/zoom fallbacks.
  -- Ghostty keybinds can't run a shell command, so we intercept here. An eventtap
  -- (not a hotkey) so it only fires when Ghostty is frontmost and passes through
  -- everywhere else (cmd+d still bookmarks in browsers, etc.). cmd+ctrl+* (ctrl
  -- held) is excluded and left to Ghostty's own default new_split/new_tab binds,
  -- the exceptions being cmd+ctrl+b (toggles the herdr sidebar like cmd+b) and
  -- cmd+ctrl+1..9 (herdr workspace switching).
  -- Gated on the focused window's app (not isGhostty) so the quick terminal keeps
  -- Ghostty's native split rather than the AppleScript fallback (targets front window).
  _G._GhosttyNewSplitTabTap = hs.eventtap.new({hs.eventtap.event.types.keyDown}, function(event)
    local flags = event:getFlags()
    if not flags.cmd or flags.alt then return false end
    local code = event:getKeyCode()
    -- cmd+b / cmd+ctrl+b -> herdr's sidebar toggle (prefix+b), only when herdr
    -- owns the visible surface; otherwise it passes through.
    local isB = code == hs.keycodes.map["b"] and not flags.shift
    -- cmd+1..9 -> focus tab N (herdr/nvim: prefix+N); cmd+ctrl+1..9 -> focus
    -- workspace N (herdr/nvim: prefix+w+N). Only claimed on a multiplexer
    -- surface; elsewhere cmd+N falls through to Ghostty's own goto_tab
    -- (super+physical:N) or to whatever app is frontmost.
    local digit = nil
    if not flags.shift then
      for n = 1, 9 do
        if code == hs.keycodes.map[tostring(n)] then digit = n break end
      end
    end
    -- Every other cmd+ctrl+* chord stays with Ghostty's own new_split/new_tab binds.
    if flags.ctrl and not (isB or digit) then return false end
    local isD = code == hs.keycodes.map["d"]
    -- cmd+t -> new tab; cmd+n -> new window/workspace (herdr: ctrl+space > shift+n).
    -- cmd+shift+n is left to pass through so the config's super+shift+n=new_window
    -- always makes a native Ghostty window.
    local isT = code == hs.keycodes.map["t"] and not flags.shift
    local isN = code == hs.keycodes.map["n"] and not flags.shift
    -- cmd+shift+[ / cmd+shift+] -> prev/next tab (herdr: ctrl+space > ctrl+p/n).
    local isPrevTab = code == hs.keycodes.map["["] and flags.shift
    local isNextTab = code == hs.keycodes.map["]"] and flags.shift
    -- cmd+w -> close pane (herdr/nvim: ctrl+space > backspace). cmd+shift+w is
    -- left to pass through so the config's super+shift+w=close_window stands.
    local isW = code == hs.keycodes.map["w"] and not flags.shift
    -- cmd+shift+enter -> toggle herdr pane zoom (herdr: ctrl+space > ctrl+enter).
    -- Only claimed on a herdr surface; elsewhere it passes through.
    local isZoom = code == hs.keycodes.map["return"] and flags.shift
    if not (isD or isT or isN or isPrevTab or isNextTab or isW or isB or isZoom or digit) then return false end
    local focused = hs.window.focusedWindow()
    local isGhosttyWindow = focused and focused:application() and focused:application():name() == "Ghostty"
    -- close-pane-with-fallback drives keybinds only (no `front window`
    -- AppleScript), so unlike the split/tab fallbacks it works in the quick
    -- terminal too -- accept it there as well.
    if not (isGhosttyWindow or ((isW or isB or digit) and Preset.isGhosttyQuickTerminalActive())) then return false end
    if digit then
      -- Returns false when the surface isn't a multiplexer: pass cmd+N through.
      if flags.ctrl then
        return GhosttyPreset.focusWorkspaceIndexWithFallback(digit)
      end
      return GhosttyPreset.focusTabIndexWithFallback(digit)
    elseif isB then
      -- Returns false when herdr doesn't own the surface: pass cmd+b through.
      return GhosttyPreset.toggleSidebarWithFallback()
    elseif isZoom then
      -- Returns false when herdr doesn't own the surface: pass cmd+shift+enter through.
      return GhosttyPreset.zoomWithFallback()
    elseif isD then
      GhosttyPreset.newSplitWithFallback(flags.shift)
    elseif isT then
      GhosttyPreset.newTabWithFallback()
    elseif isPrevTab or isNextTab then
      GhosttyPreset.focusTabWithFallback(isPrevTab and "prev" or "next")
    elseif isW then
      GhosttyPreset.closePaneWithFallback()
    else
      GhosttyPreset.newWindowWithFallback()
    end
    return true
  end)
  _G._GhosttyNewSplitTabTap:start()

  -- cmd+alt+v in Ghostty -> flatten the clipboard (all newlines/indentation
  -- collapsed to single spaces) and paste it as one line. Useful for pasting
  -- multi-line snippets into a shell prompt. An eventtap rather than a hotkey so
  -- cmd+alt+v passes through untouched in every other app.
  _G._GhosttyPasteFlattenedTap = hs.eventtap.new({hs.eventtap.event.types.keyDown}, function(event)
    local flags = event:getFlags()
    if not (flags.cmd and flags.alt) or flags.ctrl or flags.shift then return false end
    if event:getKeyCode() ~= hs.keycodes.map["v"] then return false end
    if not isGhostty() then return false end

    local text = hs.pasteboard.getContents()
    if not text then return true end
    -- Collapse every run of whitespace containing a newline into one space, then
    -- trim the ends.
    local flat = text:gsub("%s*\r?\n%s*", " "):gsub("^%s+", ""):gsub("%s+$", "")
    hs.pasteboard.setContents(flat)
    -- Delay so the physically-held cmd+alt has time to lift before the synthetic
    -- cmd+v goes out (an alt still down turns it into a different chord).
    hs.timer.doAfter(0.15, function() hs.eventtap.keyStroke({"cmd"}, "v") end)
    return true
  end)
  _G._GhosttyPasteFlattenedTap:start()

  -- Cycle iTerm + Ghostty windows as if they were a single app. Windows from
  -- both apps are merged and ordered by (Hammerspoon/CG) window id for stable
  -- cycling. When a terminal window is focused, step to the next merged window
  -- (wrapping, possibly crossing into the other app); otherwise bring the most
  -- recently used terminal window forward. `exceptId` (optional) is a window id
  -- to skip. hs.window:focus() activates the owning app for us, so no per-app
  -- AppleScript is needed.
  local function cycleTerminalWindows(exceptId)
    local wins = {}
    local eligible = {}
    for _, appName in ipairs({ "iTerm2", "Ghostty" }) do
      local app = hs.application.get(appName)
      if app then
        for _, w in ipairs(app:allWindows()) do
          local id = w:id()
          if id and w:isStandard() and id ~= exceptId then
            table.insert(wins, w)
            eligible[id] = true
          end
        end
      end
    end

    if #wins == 0 then return end

    table.sort(wins, function(x, y) return x:id() < y:id() end)

    local focused = hs.window.focusedWindow()
    local focusedId = focused and focused:id()
    local pos = nil
    for i, w in ipairs(wins) do
      if w:id() == focusedId then
        pos = i
        break
      end
    end

    if pos then
      -- On an eligible terminal window: advance to the next (wrapping).
      wins[(pos % #wins) + 1]:focus()
    else
      -- Elsewhere (or on an excluded window): most recently used eligible window.
      for _, w in ipairs(hs.window.orderedWindows()) do
        local id = w:id()
        if id and eligible[id] then
          w:focus()
          return
        end
      end
      wins[1]:focus()
    end
  end

  default:conditionalBind({"ctrl", "cmd"}, "h", {
    {cond = isiTerm, function() task({"iterm-preset", "focus-pane-with-fallback", "left"}) end},
    {cond = isGhostty, function() GhosttyPreset.focusPaneWithFallback("left") end},
    {app = "Google Chrome", function() hs.eventtap.keyStroke({"ctrl", "shift"}, "tab") end},
    {function() hs.eventtap.keyStroke({"alt", "cmd"}, "left") end},
  })
  default:conditionalBind({"ctrl", "cmd"}, "j", {
    {cond = isiTerm, function() task({"iterm-preset", "focus-pane-with-fallback", "down"}) end},
    {cond = isGhostty, function() GhosttyPreset.focusPaneWithFallback("down") end},
    {app = "Google Chrome", function() hs.eventtap.keyStroke({"cmd"}, "9") end},
    {function() hs.eventtap.keyStroke({"alt", "cmd"}, "down") end},
  })
  default:conditionalBind({"ctrl", "cmd"}, "k", {
    {cond = isiTerm, function() task({"iterm-preset", "focus-pane-with-fallback", "up"}) end},
    {cond = isGhostty, function() GhosttyPreset.focusPaneWithFallback("up") end},
    {app = "Google Chrome", function() hs.eventtap.keyStroke({"cmd"}, "1") end},
    {function() hs.eventtap.keyStroke({"alt", "cmd"}, "up") end},
  })
  default:conditionalBind({"ctrl", "cmd"}, "l", {
    {cond = isiTerm, function() task({"iterm-preset", "focus-pane-with-fallback", "right"}) end},
    {cond = isGhostty, function() GhosttyPreset.focusPaneWithFallback("right") end},
    {app = "Google Chrome", function() hs.eventtap.keyStroke({"ctrl"}, "tab") end},
    {function() hs.eventtap.keyStroke({"alt", "cmd"}, "right") end},
  })

  -- Shift+Ctrl+Cmd HJKL (per-app). Ghostty maps ctrl+cmd+arrow to resize_split
  -- in its config, so send the same keys the iTerm branch does -- except on a
  -- herdr surface, where a Ghostty resize_split would move a divider herdr does
  -- not own: GhosttyPreset.resizePaneWithFallback drives herdr's resize mode
  -- (prefix+r, direction, esc) there and falls back to ctrl+cmd+arrow elsewhere.
  default:conditionalBind({"shift", "ctrl", "cmd"}, "h", {
    {cond = isiTerm, function() hs.eventtap.keyStroke({"ctrl", "cmd"}, "left") end},
    {cond = isGhostty, function() GhosttyPreset.resizePaneWithFallback("left") end},
    {app = "Google Chrome", function() hs.eventtap.keyStroke({"ctrl", "shift"}, "pageup") end},
    {function() hs.eventtap.keyStroke({"shift", "alt", "cmd"}, "left") end},
  })
  default:conditionalBind({"shift", "ctrl", "cmd"}, "j", {
    {cond = isiTerm, function() hs.eventtap.keyStroke({"ctrl", "cmd"}, "down") end},
    {cond = isGhostty, function() GhosttyPreset.resizePaneWithFallback("down") end},
    {app = "Google Chrome", function() task({"osascript-preset", "send-keys", "ctrl", "shift", "j"}) end},
    {function() hs.eventtap.keyStroke({"shift", "alt", "cmd"}, "down") end},
  })
  default:conditionalBind({"shift", "ctrl", "cmd"}, "k", {
    {cond = isiTerm, function() hs.eventtap.keyStroke({"ctrl", "cmd"}, "up") end},
    {cond = isGhostty, function() GhosttyPreset.resizePaneWithFallback("up") end},
    {app = "Google Chrome", function() task({"osascript-preset", "send-keys", "ctrl", "shift", "k"}) end},
    {function() hs.eventtap.keyStroke({"shift", "alt", "cmd"}, "up") end},
  })
  default:conditionalBind({"shift", "ctrl", "cmd"}, "l", {
    {cond = isiTerm, function() hs.eventtap.keyStroke({"ctrl", "cmd"}, "right") end},
    {cond = isGhostty, function() GhosttyPreset.resizePaneWithFallback("right") end},
    {app = "Google Chrome", function() hs.eventtap.keyStroke({"ctrl", "shift"}, "pagedown") end},
    {function() hs.eventtap.keyStroke({"shift", "alt", "cmd"}, "right") end},
  })

  -- Resize
  default:bindOnce(hyper, "-", "Resize Smart -100", function() task({"wm-preset", "resize", "smart", "-100"}) end)
  default:bindOnce(hyper, "=", "Resize Smart +100", function() task({"wm-preset", "resize", "smart", "+100"}) end)

  -- Harpoon 1-9
  for i = 1, 9 do
    default:bindOnce(hyper, tostring(i), "Harpoon Focus " .. i, function() fish("yabai-harpoon focus " .. i) end)
  end
  default:bindOnce(hyperShift, "=", "Harpoon Add", function() fish("yabai-harpoon add") end)

  -- Window cycling
  default:bindOnce(hyper, "n", "Focus Next Window", function() fish("wm-preset focus-window-in-space next") end)
  default:bindOnce(hyper, "p", "Focus Prev Window", function() fish("wm-preset focus-window-in-space prev") end)

  -- Focus history: back/forward through windows and Chrome tabs (vim jumplist
  -- order -- o goes back, i goes forward).
  default:bindOnce(hyper, "o", "Focus History Back", function() FocusHistory.back() end)
  default:bindOnce(hyper, "i", "Focus History Forward", function() FocusHistory.forward() end)
  -- ArgList navigation: focus next/prev marked window, or error if none marked.
  default:conditionalBindOnce(hyperShift, "n", "ArgList Navigate Next", {
    {cond = function() return not ArgList.isEmpty() end, function() navigateArgList(1) end},
    {function() Preset.displayMessage("ArgList: empty") end},
  })
  default:conditionalBindOnce(hyperShift, "p", "ArgList Navigate Prev", {
    {cond = function() return not ArgList.isEmpty() end, function() navigateArgList(-1) end},
    {function() Preset.displayMessage("ArgList: empty") end},
  })

  -- Mode entries
  default:bindEnter(hyper, "space", "Enter Service Mode", service)
  default:bindEnter(hyperShift, "i", "Enter Invoke Mode", invoke)
  default:bindEnter(hyper, "'", "Enter Chrome Mode", chrome)

  -- Karabiner Mouse Layer
  default:bindOnce({}, "F18", "Enter Second Mouse Layer", function() task({"karabiner-preset", "enable-layer", "mouse-second-layer"}) end)

  -- App shortcuts
  default:bindOnce(hyper, "b", "Focus Hammerspoon Console", function() hs.toggleConsole() end)
  default:bindOnce(hyper, "c", "Focus Cursor", function() launchOrFocus("Cursor") end)
  -- iTerm + Ghostty behave as one app: when a terminal is frontmost, cycle
  -- across the windows of both; otherwise focus iTerm (if running), else Ghostty
  -- (running or launched).
  default:conditionalBindOnce(hyper, "x", "Focus Terminal", {
    { cond = isiTerm, function() cycleTerminalWindows() end },
    { cond = isGhostty, function() cycleTerminalWindows() end },
    { cond = function() return hs.application.get("iTerm2") ~= nil end, function() launchOrFocus("iTerm") end },
    { function() launchOrFocus("Ghostty") end },
  })

  default:bindOnce(hyper, "q", "Focus Gemini", function() task({"chrome-preset", "focus-or-open-url", "gemini.google.com", "--label", "Gemini"}) end)
  default:bindOnce(hyper, "w", "Focus WhatsApp", function() launchOrFocus("WhatsApp") end)
  default:bindOnce(hyperShift, "z", "Focus Obsidian", function() launchOrFocus("Obsidian") end)
  -- default:bindOnce(hyper, "s", "Toggle YouTube Music", function() Preset.alternateApp("YouTube Music", {hide = true}) end)
  default:bindOnce(hyper, "s", "Toggle Spotify", function() Preset.alternateApp("Spotify", {hide = true}) end)
  default:bindOnce(hyper, "e", "Focus Chrome", function() launchOrFocus("Google Chrome") end)
  default:bindOnce(hyper, "r", "Focus Chrome (alt)", function() launchOrFocus("Google Chrome") end)
  default:bindOnce(hyperShift, "z", "Focus Google Keep", function() launchOrFocus("Google Keep") end)
  default:conditionalBindOnce(hyperShift, "w", "Focus Zoom/Meet", {
    {cond = function() return isProcessRunning("zoom.us") end, function() task({"wm-preset", "alternate-window", "--title", "Zoom Meeting"}) end},
    {function() task({"chrome-preset", "focus-or-open-url", "meet.google.com", "--label", "Google Meet"}) end},
  })
  default:conditionalBindOnce(hyperShift, "s", "Toggle Mute Zoom/Meet", {
    {cond = function() return isProcessRunning("zoom.us") end, function()
      Preset.displayMessage("Toggle Mute")
      -- Focus the meeting window specifically (same target as hyperShift+w),
      -- so we don't land on another Zoom window when Zoom is already active.
      task({"wm-preset", "focus-window-title", "Zoom Meeting"})
      hs.timer.doAfter(0.5, function() hs.eventtap.keyStroke({"cmd", "shift"}, "a") end)
    end},
    {function()
      Preset.displayMessage("Toggle Mute")
      task({"chrome-preset", "focus-or-open-url", "meet.google.com", "--label", "Google Meet"})
      hs.timer.doAfter(0.5, function() hs.eventtap.keyStroke({"cmd"}, "d") end)
    end},
  })

  default:bindOnce(hyper, "f", "Focus Finder", function() launchOrFocus("Finder") end)
  default:bindOnce(hyperShift, "d", "Focus WhatsApp (shift)", function() launchOrFocus("WhatsApp") end)
  default:bindOnce(hyperShift, "f", "Focus Messages", function() launchOrFocus("Messages") end)
  default:bindOnce(hyperShift, "q", "Focus Activity Monitor", function() launchOrFocus("Activity Monitor") end)

  default:bindOnce(hyper, "y", "Focus Calendar", function() task({"chrome-preset", "focus-or-open-url", "calendar.google.com", "--label", "Calendar"}) end)
  default:bindOnce(hyper, "u", "Perform Default UI", function() task({"workflow-preset", "perform-default-ui"}) end)

  -- Universal Actions (per-app)
  default:conditionalBindOnce(hyper, "g", "Universal Actions", {
    {app = "iTerm2", function() fish("ua --clipboard") end},
    {app = "Ghostty", function() fish("ua --clipboard") end},
    {function() fish("ua") end},
  })
  default:bindOnce(hyperShift, "g", "Universal Actions (force)", function() fish("ua") end)

  -- kindaVim toggle
  default:conditionalBindOnce(hyperShift, "v", "Toggle kindaVim", {
    {cond = function() return isProcessRunning("kindaVim") end, function()
      Preset.displayMessage("Exit kindaVim")
      task({"killall", "kindaVim"})
    end},
    {function()
      Preset.displayMessage("Enter kindaVim")
      task({"open", "-a", "kindaVim"})
    end},
  })

  -- Paste as plain text
  default:bindOnce({"ctrl", "cmd"}, "v", "Paste as Plain Text", function()
    local text = hs.pasteboard.getContents()
    if text then hs.eventtap.keyStrokes(text) end
  end)

  -- Copy selection as markdown: selection-to-md copies the selection and
  -- converts the rich text to markdown, leaving the result on the clipboard.
  -- It copies via send-keys so the held hyper modifiers don't corrupt the Cmd+C.
  default:bindOnce(hyperShift, "c", "Copy Selection As Markdown", function()
    -- Merge stderr into stdout so the callback receives the error text.
    fish("markdown-preset selection-to-md 2>&1", function(ok, out)
      if ok then
        Preset.displayMessage("Copied as markdown", 1.5)
      else
        Preset.displayMessage(out ~= "" and out or "Copy as markdown failed", 1.5)
      end
    end)
  end)

  -- Smart lock (screensaver on AC, lock on battery)
  default:bindOnce({"ctrl", "cmd"}, "q", "Smart Lock", function()
    if hs.battery.powerSource() == "AC Power" then
      hs.caffeinate.startScreensaver()
    else
      hs.caffeinate.lockScreen()
    end
  end)

  -- ArgList: mark/unmark windows so a single action can operate on many at once
  default:bindOnce(hyper, ".", "Toggle Window In ArgList", function()
    task({"yabai-preset", "get-focused-window-id"}, function(ok, id)
      if not ok or id == "" then
        Preset.displayMessage("ArgList: no focused window")
        return
      end
      local action = ArgList.toggle(id)
      local verb = action == "added" and "Marked" or "Unmarked"
      Preset.displayMessage(verb .. " window " .. id .. " (" .. ArgList.count() .. " marked)")
    end)
  end)

  ---------------------------------------------------------------
  -- Chrome app-specific hotkeys (only active when Chrome is focused)
  ---------------------------------------------------------------

  local chromeAppModal = mode.createAppModal("Google Chrome")

  -- Only let Chrome's app-specific hotkeys fire when Chrome is the truly focused
  -- window, not merely the active app: when a floating terminal (Ghostty quick
  -- terminal / iTerm hotkey window) is up on top of Chrome, its keys (e.g.
  -- ctrl+alt+d) should go to the terminal, not Chrome.
  chromeAppModal:addPredicate(function() return not isFloatingTerminal() end)

  chromeAppModal:bind({"ctrl", "shift"}, "d", function() Preset.triggerMenuBar("Tab;Move Tab to New Window") end)
  chromeAppModal:bind({"ctrl", "alt"}, "d", function() Preset.triggerMenuBar("Tab;Duplicate Tab") end)
  chromeAppModal:bind({"ctrl", "alt", "shift"}, "d", function()
    Preset.triggerMenuBarSync("Tab;Duplicate Tab")
    hs.timer.usleep(200000)
    Preset.triggerMenuBarSync("Tab;Move Tab to New Window")
  end)
  chromeAppModal:bind({"ctrl", "shift"}, "g", function() Preset.triggerMenuBar("Tab;Group Tab") end)
  chromeAppModal:bind({"ctrl", "cmd"}, "1", function()
    hs.eventtap.keyStroke({"alt", "shift"}, "1")
    hs.eventtap.keyStroke({"ctrl", "shift"}, "1")
  end)

  -- new tab to the right
  chromeAppModal:bind({"ctrl", "cmd"}, "t", function()
    task({"chrome-preset", "new-tab", "--right"})
  end)

  chromeAppModal:bind({"ctrl", "cmd"}, "b", function()
    task({"chrome-preset", "toggle-tabbar"})
  end)

  ---------------------------------------------------------------
  -- SERVICE MODE bindings
  ---------------------------------------------------------------

  -- Neovide paste in service
  service:bindOnce(hyper, "v", "Neovide Paste", function()
    hs.eventtap.keyStroke({"cmd"}, "c")
    hs.timer.doAfter(0.1, function() fish("pbneovide --guess") end)
  end)

  -- Harpoon
  service:bindOnce({}, "a", "Harpoon Add", function() fish("yabai-harpoon add") end)
  service:bindOnce({}, "e", "Harpoon Edit", function() fish("yabai-harpoon edit") end)

  -- Harpoon pinfiles: save, load (via chooser), edit
  service:bindOnce(hyper, "s", "Harpoon Write Pinfile", function()
    local button, name = hs.dialog.textPrompt("Write Pinfile", "Enter pinfile name:", "", "OK", "Cancel")
    if button == "OK" and name and name ~= "" then
      fish("yabai-harpoon write-pinfile " .. string.format("%q", name))
    end
  end)
  service:bindOnce(hyper, "y", "Harpoon Load Pinfile", function()
    fish("yabai-harpoon list-pinfiles", function(ok, out)
      if not ok or out == "" then
        Preset.displayMessage("yabai-harpoon: no pinfiles")
        return
      end
      local choices = {}
      for name in out:gmatch("[^\n]+") do
        choices[#choices + 1] = {text = name, name = name}
      end
      local chooser = hs.chooser.new(function(choice)
        if choice then fish("yabai-harpoon load-pinfile " .. string.format("%q", choice.name)) end
      end)
      chooser:choices(choices)
      chooser:show()
    end)
  end)
  service:bindOnce({"shift"}, "e", "Harpoon Edit Pinfiles", function() fish("yabai-harpoon edit-pinfiles") end)

  -- Cycle window selection in three stages: first press marks the foreground
  -- (un-occluded) windows, second press expands to every window in the space,
  -- third press (everything already marked) clears the arglist.
  service:bindOnce(hyper, "a", "Select Visible / All Windows In Space", function()
    -- Splits newline-separated command output into a list of window ids.
    local function splitIds(out)
      local ids = {}
      for _, id in ipairs(hs.fnutils.split(out, "\n")) do
        if id ~= "" then ids[#ids + 1] = id end
      end
      return ids
    end

    -- Marks every id in the list; returns true if anything new was added,
    -- i.e. the arglist changed.
    local function addAll(ids)
      local changed = false
      for _, id in ipairs(ids) do
        if ArgList.add(id) then changed = true end
      end
      return changed
    end

    a.sync(function()
      -- Stage 1: foreground-visible windows. Skipped when there is only one
      -- visible window (marking a single window is pointless) or when
      -- empty/unsupported (e.g. AeroSpace) — both fall through to the
      -- all-windows stage below.
      local _, visibleOut = a.wait(fishAsync("wm-preset list-visible-windows | jq -r .id"))
      local visible = splitIds(visibleOut)
      if #visible > 1 and addAll(visible) then
        Preset.displayMessage("Selected visible windows (" .. ArgList.count() .. " marked)")
        return
      end

      -- Stage 2: every window in the current space.
      local ok, spaceOut = a.wait(taskAsync({"wm-preset", "get-space-window-ids"}))
      local space = splitIds(spaceOut)
      if not ok or #space == 0 then
        Preset.displayMessage("ArgList: no windows in space")
        return
      end
      if addAll(space) then
        Preset.displayMessage("Selected all windows (" .. ArgList.count() .. " marked)")
        return
      end

      -- Stage 3: everything already marked -> clear.
      ArgList.clear()
      Preset.displayMessage("Deselected all windows")
    end)()
  end)

  -- ArgList populated: clear it. Empty: clear the harpoon pins (default behavior).
  service:conditionalBindOnce({}, "delete", "Clear ArgList / Harpoon Pins", {
    {cond = function() return not ArgList.isEmpty() end, function()
      local count = ArgList.count()
      ArgList.clear()
      Preset.displayMessage("Cleared ArgList (" .. count .. " windows)")
    end},
    {function() fish("yabai-harpoon delete") end},
  })

  -- Side-by-side: arrange the marked windows (2-6) into an optimal grid.
  service:bindOnce({"shift"}, ";", "Side By Side", function()
    local count = ArgList.count()
    if count == 0 then
      Preset.displayMessage("Side By Side: no windows selected")
      return
    elseif count == 1 then
      Preset.displayMessage("Side By Side: select at least 2 windows")
      return
    elseif count >= 7 then
      Preset.displayMessage("Side By Side: too many windows (max 6)")
      return
    end

    local args = {"yabai-preset", "side-by-side"}
    for _, id in ipairs(ArgList.items()) do args[#args + 1] = id end
    task(args, function(ok)
      if ok then
        Preset.displayMessage("Side By Side: arranged " .. count .. " windows")
      else
        Preset.displayMessage("Side By Side: failed")
      end
    end)
  end)

  -- Edit hammerspoon keybindings
  service:bindOnce(hyper, "e", "Edit Keybindings", function()
    Preset.displayMessage("Edit Keybindings")
    fish('neovim-ghost focus-or-new-tab "$HOME/.hammerspoon/keybindings.lua"')
  end)

  -- Space focus
  service:bindOnce(hyper, "space", "Focus Space Recent", function() task({"wm-preset", "focus-space", "recent"}) end)
  service:bindOnce({}, "space", "Focus Back And Forth", function() task({"wm-preset", "focus-back-and-forth"}) end)
  service:bindOnce({"shift"}, "space", "Move Window To Space Recent", function() task({"wm-preset", "move-window-to-space", "recent"}) end)

  -- Mode transitions
  service:bindEnter({}, "r", "Enter Resize Mode", resize)
  service:bindEnter(hyper, "r", "Enter Restart Mode", restart)

  -- Window management
  service:bindOnce({"shift"}, "y", "Toggle WM", function() task({"wm-preset", "toggle-wm"}) end)
  service:bindOnce({}, "v", "Insert Direction East", function() task({"wm-preset", "insert-direction", "east"}) end)
  service:bindOnce({"shift"}, "'", "Insert Direction South", function() task({"wm-preset", "insert-direction", "south"}) end)
  -- ArgList empty: toggle the focused window. Populated: if any marked window is
  -- floating, tile them all; otherwise float them all.
  service:conditionalBindOnce({}, "t", "Toggle Float", {
    {cond = function() return not ArgList.isEmpty() end, function()
      local ids = {}
      for _, id in ipairs(ArgList.items()) do ids[#ids + 1] = id end

      a.sync(function()
        local anyFloating = false
        for _, id in ipairs(ids) do
          if a.wait(taskAsync({"wm-preset", "is-window-floating", id})) then
            anyFloating = true
            break
          end
        end

        local flag = anyFloating and "--tiling" or "--floating"
        for _, id in ipairs(ids) do
          a.wait(taskAsync({"wm-preset", "enforce-tiling", flag, id}))
        end

        local verb = anyFloating and "Tiled" or "Floated"
        Preset.displayMessage(verb .. " " .. #ids .. " windows")
      end)()
    end},
    {function() fish('display-message (wm-preset toggle-float)') end},
  })
  service:bindOnce({}, "z", "Insert Direction Stack", function() task({"wm-preset", "insert-direction", "stack"}) end)
  service:bindOnce({}, "s", "Insert Direction Stack (s)", function() task({"wm-preset", "insert-direction", "stack"}) end)
  -- ArgList empty: stack everything in the space (default). 1 marked: error.
  -- 2+ marked: stack just the marked windows.
  service:conditionalBindOnce({"shift"}, "s", "Stack Windows In Space", {
    {cond = function() return ArgList.isEmpty() end, function()
      task({"wm-preset", "stack-windows-in-space"})
    end},
    {cond = function() return ArgList.count() == 1 end, function()
      Preset.displayMessage("Stack: select at least 2 windows")
    end},
    {function()
      local count = ArgList.count()
      local args = {"wm-preset", "stack-window-ids"}
      for _, id in ipairs(ArgList.items()) do args[#args + 1] = id end
      task(args, function(ok)
        if ok then
          Preset.displayMessage("Stacked " .. count .. " windows")
        else
          Preset.displayMessage("Stack: failed")
        end
      end)
    end},
  })
  service:bindOnce({}, "m", "Minimize After 3rd", function() task({"wm-preset", "minimize-after-nth-window", "3"}) end)
  service:bindOnce({"shift"}, "m", "Deminimize All", function() task({"wm-preset", "deminimize-all"}) end)
  service:bindOnce({}, ",", "Layout Stack", function() task({"wm-preset", "layout-stack"}) end)
  service:bindOnce({"shift"}, ",", "Layout BSP + Stack", function() fish("wm-preset layout-bsp; wm-preset stack-windows-in-space") end)
  service:bindOnce({"shift"}, ".", "Layout BSP + Minimize", function() fish("wm-preset layout-bsp; wm-preset minimize-after-nth-window 3") end)
  service:bindOnce({"shift"}, "t", "Layout Float", function() task({"wm-preset", "layout-float"}) end)
  service:bindOnce({}, ".", "Layout BSP", function() task({"wm-preset", "layout-bsp"}) end)
  service:bindOnce({}, "0", "Flatten", function() task({"wm-preset", "flatten"}) end)

  -- Mirror / split / balance
  service:bindOnce({"shift"}, "\\", "Mirror Y-Axis", function() task({"wm-preset", "mirror", "y-axis"}) end)
  service:bindOnce({}, "-", "Mirror X-Axis", function() task({"wm-preset", "mirror", "x-axis"}) end)
  service:bindOnce({}, "y", "Toggle Split", function() task({"wm-preset", "toggle-split"}) end)
  service:bindOnce({}, "=", "Balance", function() task({"wm-preset", "balance"}) end)

  -- Focus space 1-9
  for i = 1, 9 do
    service:bindOnce({}, tostring(i), "Focus Space " .. i, function() task({"wm-preset", "focus-space", tostring(i)}) end)
  end

  -- Move window to space 1-9.
  -- ArgList empty: move the current window. ArgList populated: hand the ids to
  -- move-window-ids-to-space (the list is kept for further use).
  for i = 1, 9 do
    service:conditionalBindOnce({"shift"}, tostring(i), "Move Window(s) To Space " .. i, {
      {cond = function() return ArgList.isEmpty() end, function()
        task({"wm-preset", "move-window-to-space", tostring(i)})
      end},
      {function()
        local count = ArgList.count()
        local args = {"wm-preset", "move-window-ids-to-space", "--space", tostring(i)}
        for _, id in ipairs(ArgList.items()) do args[#args + 1] = id end
        task(args, function(ok)
          if ok then
            Preset.displayMessage("Moved " .. count .. " windows to space " .. i)
          else
            Preset.displayMessage("Move cancelled: a window did not focus")
          end
        end)
      end},
    })
  end

  -- Warp window HJKL
  service:bindOnce(hyper, "h", "Warp Window West", function() task({"wm-preset", "warp-window", "west"}) end)
  service:bindOnce(hyper, "j", "Warp Window South", function() task({"wm-preset", "warp-window", "south"}) end)
  service:bindOnce(hyper, "k", "Warp Window North", function() task({"wm-preset", "warp-window", "north"}) end)
  service:bindOnce(hyper, "l", "Warp Window East", function() task({"wm-preset", "warp-window", "east"}) end)

  -- Focus display HJKL
  service:bindOnce({}, "h", "Focus Display West", function() task({"wm-preset", "focus-display-with-fallback", "west"}) end)
  service:bindOnce({}, "j", "Focus Display South", function() task({"wm-preset", "focus-display-with-fallback", "south"}) end)
  service:bindOnce({}, "k", "Focus Display North", function() task({"wm-preset", "focus-display-with-fallback", "north"}) end)
  service:bindOnce({}, "l", "Focus Display East", function() task({"wm-preset", "focus-display-with-fallback", "east"}) end)

  -- Misc service
  service:bindOnce(hyper, "]", "Harpoon Focus Pin Next", function() fish("yabai-harpoon focus-pin next") end)
  service:bindOnce(hyper, "[", "Harpoon Focus Pin Prev", function() fish("yabai-harpoon focus-pin prev") end)
  service:bindOnce({"shift"}, "tab", "Move Window To Next Display", function() task({"wm-preset", "smart-move-window-to-next-display"}) end)
  service:bindOnce(hyperShift, "tab", "Swap Workspaces Between Monitors", function() task({"wm-preset", "swap-workspaces-between-monitors"}) end)
  service:bindOnce({"shift"}, "/", "Trigger Help Menu", function() Preset.triggerMenuBar("Help") end)
  service:bindOnce({"shift"}, "v", "Tile Left", function() Preset.triggerMenuBar("Window;Full Screen Tile; Left of Screen") end)
  service:bindOnce(hyper, "return", "True Fullscreen", function() hs.eventtap.keyStroke({"ctrl", "cmd"}, "f") end)

  -- Enter chrome from service
  service:bindEnter({}, "c", "Enter Chrome Mode", chrome)

  ---------------------------------------------------------------
  -- RESIZE MODE bindings (stays in mode, no exit on key press)
  ---------------------------------------------------------------

  resize:bind({}, "return", function() resize:exit() end)
  resize:bind({}, "j", function() task({"wm-preset", "resize", "height", "+100"}) end)
  resize:bind({}, "k", function() task({"wm-preset", "resize", "height", "-100"}) end)
  resize:bind({}, "h", function() task({"wm-preset", "resize", "width", "-100"}) end)
  resize:bind({}, "l", function() task({"wm-preset", "resize", "width", "+100"}) end)
  resize:bind({"shift"}, "j", function() task({"wm-preset", "resize", "height", "+100"}) end)
  resize:bind({"shift"}, "k", function() task({"wm-preset", "resize", "height", "-100"}) end)
  resize:bind({"shift"}, "h", function() task({"wm-preset", "resize", "width", "-100"}) end)
  resize:bind({"shift"}, "l", function() task({"wm-preset", "resize", "width", "+100"}) end)
  resize:bind({"shift"}, ",", function() task({"wm-preset", "rotate", "90"}) end)
  resize:bind({"shift"}, ".", function() task({"wm-preset", "rotate", "270"}) end)

  ---------------------------------------------------------------
  -- RESTART MODE bindings
  ---------------------------------------------------------------

  restart:bindOnce(hyper, "y", "Restart WM", function() task({"yabai-preset", "restart-wm"}) end)
  restart:bindOnce(hyper, "a", "Restart Alfred", function() Preset.displayMessage("Restart Alfred"); fish('killall Alfred; sleep 2; and open -a "Alfred 5"') end)
  restart:bindOnce(hyper, "m", "Restart Mouseless", function() Preset.displayMessage("Restart Mouseless"); fish('killall mouseless; sleep 2; and open -a "Mouseless"') end)
  restart:bindOnce(hyper, "v", "Restart NVIM Ghost", function() Preset.displayMessage("Restart NVIM Ghost"); fish("neovim-ghost kill; sleep 2; and neovim-ghost start --spawn") end)
  restart:bindOnce(hyper, "k", "Restart Karabiner", function() Preset.displayMessage("Restart Karabiner"); fish('launchctl kickstart -k gui/(id -u)/org.pqrs.service.agent.karabiner_console_user_server') end)
  restart:bindOnce(hyper, "h", "Restart Hammerspoon", function() Preset.displayMessage("Restarting Hammerspoon"); hs.reload() end)
  restart:bindOnce(hyperShift, "b", "Restart Hammerspoon", function() Preset.displayMessage("Restarting Hammerspoon"); hs.reload() end)
  restart:bindEnter(hyper, "p", "Enter Repin Mode", repin)
  restart:conditionalBindOnce(hyper, "s", "Toggle AeroSpace", {
    {cond = function() return isProcessRunning("AeroSpace") end, function()
      a.sync(function()
        Preset.displayMessage("Quitting AeroSpace")
        -- Click "Quit AeroSpace" in AeroSpace's menu bar extra (graceful quit).
        a.wait(taskAsync({"osascript-preset", "click-status-menu", "AeroSpace;Quit AeroSpace"}))
        -- If it didn't quit gracefully within 5s, force kill it.
        a.wait(sleep(5))
        if a.wait(isProcessRunning("AeroSpace")) then
          Preset.displayMessage("Force killing AeroSpace")
          task({"killall", "AeroSpace"})
        end
      end)()
    end},
    {function()
      task({"yabai-preset", "layout-float-all"})
      Preset.displayMessage("Starting AeroSpace")
      task({"open", "-a", "AeroSpace"})
    end},
  })

  ---------------------------------------------------------------
  -- REPIN MODE bindings
  ---------------------------------------------------------------


  ---------------------------------------------------------------
  -- CHROME MODE bindings
  ---------------------------------------------------------------

  -- Mode transitions
  chrome:bindEnter(hyper, "'", "Enter Go To Mode", goto_mode)
  chrome:bind({}, "'", function() chrome:exit(); goto_mode:enter() end)

  -- Close zoom tabs
  chrome:bindOnce({}, "delete", "Close Zoom Tabs", function() task({"chrome-preset", "close-tabs-with-url", [[^.*\.zoom\.us/j/.*$]]}) end)

  -- Focus pinned tab 1-9
  for i = 1, 9 do
    chrome:bindOnce({}, tostring(i), "Focus Pinned Tab " .. i, function() task({"chrome-preset", "focus-pinned-tab", tostring(i)}) end)
  end

  -- Chrome / Go To URL shortcuts
  bindWebApp("y", "YouTube", "youtube.com", {chrome = "focus-or-open-url"})
  bindWebApp("g", "Gmail", "mail.google.com", {chrome = "focus-or-open-url"})

  ---------------------------------------------------------------
  -- INVOKE MODE bindings
  ---------------------------------------------------------------


  invoke:bindOnce({}, "1", "Arrange Work Spaces", function()
    task({"wm-preset", "arrange-spaces", "-w", [[1:.*Thales \(Work\).*]], "-a", "2:iTerm2", "-a", [[3:.*VS Code.*]], "-a", "4:Workchat", "-a", "5:Obsidian"})
  end)
  invoke:bindOnce({}, "p", "Arrange Personal Spaces", function()
    task({"wm-preset", "arrange-spaces", "-w", [[7:.*Thales \(Personal\).*]]})
  end)
  invoke:bindOnce({}, "b", "Alfred BTT Search", function() hs.applescript([[tell application "Alfred" to search "btt "]]) end)
  invoke:bindOnce({}, "t", "Alfred Top Search", function() hs.applescript([[tell application "Alfred" to search "top "]]) end)
  invoke:bindOnce({}, "y", "YouTube Search", function() task({"open", "raycast://extensions/tonka3000/youtube/search-videos?arguments=%7B%22query%22%3A%22%22%7D"}) end)
  invoke:bindOnce({}, "return", "New Ghostty Window", function() GhosttyPreset.newWindow() end)
  invoke:bindOnce(hyper, "i", "AI Input Mode", function() Preset.displayMessage("AI Input Mode"); fish('osascript -e "set volume input volume 100"; display-message "$(set-preferred-input-device)"') end)
  invoke:bindOnce(hyper, "r", "Reinitialize Displays", function() Preset.displayMessage("Reinitialize Displays"); fish("betterdisplaycli perform --reinitialize") end)
  ---------------------------------------------------------------
  -- Apply local overrides
  ---------------------------------------------------------------

  local ctx = {
    fish = fish,
    fishAsync = fishAsync,
    task = task,
    taskAsync = taskAsync,
    focusedWindowAppName = focusedWindowAppName,
    default = default,
    service = service,
    chrome = chrome,
    goto_mode = goto_mode,
    invoke = invoke,
    resize = resize,
    restart = restart,
    repin = repin,
    hyper = hyper,
    hyperShift = hyperShift,
    registerBinding = registerBinding,
    Mode = Mode,
    isiTermFloatingTerminal = isiTermFloatingTerminal,
    isFloatingTerminal = isFloatingTerminal,
    chromeAppModal = chromeAppModal,
    launchOrFocus = launchOrFocus,
    Preset = Preset,
    bindWebApp = bindWebApp,
  }

  if ok and localConfig and localConfig.setup then
    localConfig.setup(ctx)
  end

  ---------------------------------------------------------------
  -- Module return
  ---------------------------------------------------------------

  return ctx
end

return M
