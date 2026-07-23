local shell = require("shell")
local mode = require("mode")
local palette = require("palette")
local util = require("util")
local Preset = require("preset")
local a = require("async")
local ArgList = require("arglist")
local PreviewHud = require("preview_hud")

local task = shell.task
local taskAsync = shell.taskAsync
local fish = shell.fish
local fishAsync = shell.fishAsync
local sleep = shell.sleepAsync
local frontAppName = mode.frontAppName
local isFloatingTerminal = Preset.isFloatingTerminalActive
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
  -- Fallback hyper key (Caps Lock) when Karabiner is not running
  ---------------------------------------------------------------

  require("caps_hyper").setup()

  ---------------------------------------------------------------
  -- DEFAULT MODE bindings
  ---------------------------------------------------------------

  -- Command palette
  default:bindOnce(hyperShift, ";", "Command Palette", showCommandPalette)

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

  -- Window focus HJKL
  default:conditionalBindOnce(hyper, "h", "Focus Window West", {
    {cond = isSpaceStack, function() task({"yabai-preset", "focus-stack-aware", "west"}) end},
    {function() fish("wm-preset focus-window west; or wm-preset focus-floating-window west") end},
  })
  default:conditionalBindOnce(hyper, "j", "Focus Window South", {
    {cond = isSpaceStack, function() task({"yabai-preset", "focus-stack-aware", "south"}) end},
    {function() fish("wm-preset focus-window south; or wm-preset focus-floating-window south") end},
  })
  default:conditionalBindOnce(hyper, "k", "Focus Window North", {
    {cond = isSpaceStack, function() task({"yabai-preset", "focus-stack-aware", "north"}) end},
    {function() fish("wm-preset focus-window north; or wm-preset focus-floating-window north") end},
  })
  default:conditionalBindOnce(hyper, "l", "Focus Window East", {
    {cond = isSpaceStack, function() task({"yabai-preset", "focus-stack-aware", "east"}) end},
    {function() fish("wm-preset focus-window east; or wm-preset focus-floating-window east") end},
  })

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
    return isFloatingTerminal() or frontAppName() == "iTerm2"
  end

  default:conditionalBind({"ctrl", "cmd"}, "h", {
    {cond = isiTerm, function() task({"iterm-preset", "focus-pane-with-fallback", "left"}) end},
    {app = "Google Chrome", function() hs.eventtap.keyStroke({"ctrl", "shift"}, "tab") end},
    {function() hs.eventtap.keyStroke({"alt", "cmd"}, "left") end},
  })
  default:conditionalBind({"ctrl", "cmd"}, "j", {
    {cond = isiTerm, function() task({"iterm-preset", "focus-pane-with-fallback", "down"}) end},
    {app = "Google Chrome", function() hs.eventtap.keyStroke({"cmd"}, "9") end},
    {function() hs.eventtap.keyStroke({"alt", "cmd"}, "down") end},
  })
  default:conditionalBind({"ctrl", "cmd"}, "k", {
    {cond = isiTerm, function() task({"iterm-preset", "focus-pane-with-fallback", "up"}) end},
    {app = "Google Chrome", function() hs.eventtap.keyStroke({"cmd"}, "1") end},
    {function() hs.eventtap.keyStroke({"alt", "cmd"}, "up") end},
  })
  default:conditionalBind({"ctrl", "cmd"}, "l", {
    {cond = isiTerm, function() task({"iterm-preset", "focus-pane-with-fallback", "right"}) end},
    {app = "Google Chrome", function() hs.eventtap.keyStroke({"ctrl"}, "tab") end},
    {function() hs.eventtap.keyStroke({"alt", "cmd"}, "right") end},
  })

  -- Shift+Ctrl+Cmd HJKL (per-app)
  default:conditionalBind({"shift", "ctrl", "cmd"}, "h", {
    {cond = isiTerm, function() hs.eventtap.keyStroke({"ctrl", "cmd"}, "left") end},
    {app = "Google Chrome", function() hs.eventtap.keyStroke({"ctrl", "shift"}, "pageup") end},
    {function() hs.eventtap.keyStroke({"shift", "alt", "cmd"}, "left") end},
  })
  default:conditionalBind({"shift", "ctrl", "cmd"}, "j", {
    {cond = isiTerm, function() hs.eventtap.keyStroke({"ctrl", "cmd"}, "down") end},
    {app = "Google Chrome", function() task({"osascript-preset", "send-keys", "ctrl", "shift", "j"}) end},
    {function() hs.eventtap.keyStroke({"shift", "alt", "cmd"}, "down") end},
  })
  default:conditionalBind({"shift", "ctrl", "cmd"}, "k", {
    {cond = isiTerm, function() hs.eventtap.keyStroke({"ctrl", "cmd"}, "up") end},
    {app = "Google Chrome", function() task({"osascript-preset", "send-keys", "ctrl", "shift", "k"}) end},
    {function() hs.eventtap.keyStroke({"shift", "alt", "cmd"}, "up") end},
  })
  default:conditionalBind({"shift", "ctrl", "cmd"}, "l", {
    {cond = isiTerm, function() hs.eventtap.keyStroke({"ctrl", "cmd"}, "right") end},
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
  default:bindEnter(hyper, "i", "Enter Invoke Mode", invoke)
  default:bindEnter(hyper, "'", "Enter Chrome Mode", chrome)

  -- Karabiner Mouse Layer
  default:bindOnce({}, "F18", "Enter Second Mouse Layer", function() task({"karabiner-preset", "enable-layer", "mouse-second-layer"}) end)

  -- App shortcuts
  default:bindOnce(hyper, "b", "Focus Hammerspoon Console", function() hs.toggleConsole() end)
  default:bindOnce(hyper, "c", "Focus Cursor", function() launchOrFocus("Cursor") end)
  default:conditionalBindOnce(hyper, "x", "Focus iTerm2", {
    {
      app = "iTerm2", function ()
        hs.eventtap.keyStroke({"cmd"}, "`")
      end
    },
    {
      cond = isFloatingTerminal, function ()
        launchOrFocus("iTerm")
        hs.eventtap.keyStroke({"cmd"}, "`")
      end
    },
    { function () launchOrFocus("iTerm") end }
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
      hs.alert.show("Toggle Mute")
      launchOrFocus("zoom.us")
      hs.timer.doAfter(0.5, function() hs.eventtap.keyStroke({"cmd", "shift"}, "a") end)
    end},
    {function()
      hs.alert.show("Toggle Mute")
      task({"chrome-preset", "focus-or-open-url", "meet.google.com", "--label", "Google Meet"})
      hs.timer.doAfter(0.5, function() hs.eventtap.keyStroke({"cmd"}, "d") end)
    end},
  })

  default:bindOnce(hyperShift, "f", "Focus Finder", function() launchOrFocus("Finder") end)
  default:bindOnce(hyperShift, "d", "Focus WhatsApp (shift)", function() launchOrFocus("WhatsApp") end)
  default:bindOnce(hyperShift, "g", "Focus Messages", function() launchOrFocus("Messages") end)
  default:bindOnce(hyperShift, "q", "Focus Activity Monitor", function() launchOrFocus("Activity Monitor") end)

  default:bindOnce(hyper, "y", "Focus Calendar", function() task({"chrome-preset", "focus-or-open-url", "calendar.google.com", "--label", "Calendar"}) end)
  default:bindOnce(hyper, "u", "Perform Default UI", function() task({"workflow-preset", "perform-default-ui"}) end)

  -- Universal Actions (per-app)
  default:conditionalBindOnce(hyper, "o", "Universal Actions", {
    {app = "iTerm2", function() fish("ua --clipboard") end},
    {function() fish("ua") end},
  })
  default:bindOnce(hyperShift, "o", "Universal Actions (force)", function() fish("ua") end)

  -- kindaVim toggle
  default:conditionalBindOnce(hyperShift, "v", "Toggle kindaVim", {
    {cond = function() return isProcessRunning("kindaVim") end, function()
      hs.alert.show("Exit kindaVim")
      task({"killall", "kindaVim"})
    end},
    {function()
      hs.alert.show("Enter kindaVim")
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

  chromeAppModal:bind({"cmd"}, "t", function()
    if isFloatingTerminal() then
      task({"osascript", "-e", [[
        tell application "iTerm"
          tell current window
            set pName to profile name of current session of current tab
            create tab with profile pName
          end tell
        end tell
      ]]})
    else
      task({"chrome-preset", "new-tab", "--right"})
    end
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
    hs.alert.show("Edit Keybindings")
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
  service:bindOnce({}, "tab", "Harpoon Focus Pin Next", function() fish("yabai-harpoon focus-pin next") end)
  service:bindOnce({"shift"}, "tab", "Move Window To Next Display", function() task({"wm-preset", "smart-move-window-to-next-display"}) end)
  service:bindOnce(hyperShift, "tab", "Swap Workspaces Between Monitors", function() task({"wm-preset", "swap-workspaces-between-monitors"}) end)
  service:bindOnce({"shift"}, "/", "Trigger Help Menu", function() Preset.triggerMenuBar("Help") end)
  service:bindOnce(hyper, "/", "Search Mappings", showCommandPalette)
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
  restart:bindOnce(hyper, "a", "Restart Alfred", function() hs.alert.show("Restart Alfred"); fish('killall Alfred; sleep 2; and open -a "Alfred 5"') end)
  restart:bindOnce(hyper, "m", "Restart Mouseless", function() hs.alert.show("Restart Mouseless"); fish('killall mouseless; sleep 2; and open -a "Mouseless"') end)
  restart:bindOnce(hyper, "v", "Restart NVIM Ghost", function() hs.alert.show("Restart NVIM Ghost"); fish("neovim-ghost kill; sleep 2; and neovim-ghost start --spawn") end)
  restart:bindOnce(hyper, "k", "Restart Karabiner", function() hs.alert.show("Restart Karabiner"); fish('launchctl kickstart -k gui/(id -u)/org.pqrs.service.agent.karabiner_console_user_server') end)
  restart:bindOnce(hyper, "h", "Restart Hammerspoon", function() hs.alert.show("Restarting Hammerspoon"); hs.reload() end)
  restart:bindOnce(hyperShift, "b", "Restart Hammerspoon", function() hs.alert.show("Restarting Hammerspoon"); hs.reload() end)
  restart:bindEnter(hyper, "p", "Enter Repin Mode", repin)
  restart:conditionalBindOnce(hyper, "s", "Toggle AeroSpace", {
    {cond = function() return isProcessRunning("AeroSpace") end, function()
      a.sync(function()
        hs.alert.show("Quitting AeroSpace")
        -- Click "Quit AeroSpace" in AeroSpace's menu bar extra (graceful quit).
        a.wait(taskAsync({"osascript-preset", "click-status-menu", "AeroSpace;Quit AeroSpace"}))
        -- If it didn't quit gracefully within 5s, force kill it.
        a.wait(sleep(5))
        if a.wait(isProcessRunning("AeroSpace")) then
          hs.alert.show("Force killing AeroSpace")
          task({"killall", "AeroSpace"})
        end
      end)()
    end},
    {function()
      task({"yabai-preset", "layout-float-all"})
      hs.alert.show("Starting AeroSpace")
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
  invoke:bindOnce({}, "return", "New iTerm Window", function() task({"iterm-preset", "new-window"}) end)
  invoke:bindOnce(hyper, "i", "AI Input Mode", function() hs.alert.show("AI Input Mode"); fish('osascript -e "set volume input volume 100"; set-preferred-input-device') end)
  invoke:bindOnce(hyper, "r", "Reinitialize Displays", function() hs.alert.show("Reinitialize Displays"); fish("betterdisplaycli perform --reinitialize") end)

  ---------------------------------------------------------------
  -- Apply local overrides
  ---------------------------------------------------------------

  local ctx = {
    fish = fish,
    fishAsync = fishAsync,
    task = task,
    taskAsync = taskAsync,
    frontAppName = frontAppName,
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
