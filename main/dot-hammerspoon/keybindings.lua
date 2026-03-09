-- keybindings.lua - Hammerspoon keybindings (replaces skhd)

local FISH = "/opt/homebrew/bin/fish"

-- Modifier shorthands (matching skhd's ctrl + alt + cmd)
local hyper = {"ctrl", "alt", "cmd"}
local hyperShift = {"ctrl", "alt", "cmd", "shift"}

---------------------------------------------------------------
-- Helper functions
---------------------------------------------------------------

-- Async (fire-and-forget) shell command via fish
local function shell(cmd)
  hs.task.new(FISH, nil, {"-c", cmd}):start()
end

-- Sync shell command, returns (success, output_string)
local function shellSync(cmd)
  local quoted = "'" .. cmd:gsub("'", "'\\''") .. "'"
  local output, status = hs.execute(FISH .. " -c " .. quoted)
  return status, output or ""
end

-- Get frontmost application name
local function frontAppName()
  local app = hs.application.frontmostApplication()
  return app and app:name() or ""
end

---------------------------------------------------------------
-- Command palette
---------------------------------------------------------------

local allBindings = {}

local function registerBinding(name, fn)
  table.insert(allBindings, {text = name, fn = fn})
end

local function showCommandPalette()
  local chooser = hs.chooser.new(function(choice)
    if choice and choice.fn then choice.fn() end
  end)
  chooser:choices(allBindings)
  chooser:show()
end

---------------------------------------------------------------
-- Modal system
---------------------------------------------------------------

local function createModal(name)
  local modal = hs.hotkey.modal.new()
  local alertUUID = nil
  function modal:entered()
    if name then alertUUID = hs.alert.show(name, true) end
  end
  function modal:exited()
    if alertUUID then hs.alert.closeSpecific(alertUUID) end
    alertUUID = nil
  end
  modal:bind({}, "escape", function() modal:exit() end)
  return modal
end

local service   = createModal(nil)
local chrome    = createModal("Chrome")
local goto_mode = createModal("Go To")
local invoke    = createModal("Invoke")
local resize    = createModal("Resize")
local restart   = createModal("Restart")

---------------------------------------------------------------
-- Local config
---------------------------------------------------------------

local ok, localConfig = pcall(dofile, os.getenv("HOME") .. "/.hammerspoon_local.lua")

---------------------------------------------------------------
-- Binding helpers
---------------------------------------------------------------

local function bindDefault(mods, key, name, fn)
  hs.hotkey.bind(mods, key, fn)
  registerBinding(name, fn)
end

local function bindModal(modal, prefix, mods, key, name, fn)
  modal:bind(mods, key, function() modal:exit(); fn() end)
  registerBinding(prefix .. name, fn)
end

---------------------------------------------------------------
-- DEFAULT MODE bindings
---------------------------------------------------------------

-- Command palette
bindDefault(hyperShift, ";", "Command Palette", showCommandPalette)

-- Utility
bindDefault(hyperShift, "m", "Deminimize Last", function() shell("wm-preset deminimize-last") end)
bindDefault(hyper, "m", "Minimize", function() shell("wm-preset minimize") end)
bindDefault(hyper, "return", "Smart Toggle Fullscreen", function() shell("wm-preset smart-toggle-fullscreen") end)
bindDefault(hyperShift, "return", "Unstacked Swap Largest", function() shell("wm-preset unstacked-swap-largest") end)

-- Neovide / BTT
bindDefault(hyper, "v", "Neovide Toggle", function() shell('btt-preset alternate-app "Neovide" --hide --cmd "neovim-ghost trigger"') end)
bindDefault(hyper, "t", "Chrome: New Tab and Focus", function() shell('btt-preset trigger-named-trigger "Chrome: New Tab and Focus"') end)

-- Space navigation
bindDefault(hyper, "[", "Focus Space Prev", function() shell("wm-preset focus-space prev") end)
bindDefault(hyper, "]", "Focus Space Next", function() shell("wm-preset focus-space next") end)

-- Window focus HJKL
bindDefault(hyper, "h", "Focus Window West", function() shell("wm-preset focus-window west; or wm-preset focus-floating-window west") end)
bindDefault(hyper, "j", "Focus Window South", function() shell("wm-preset focus-window south; or wm-preset focus-floating-window south") end)
bindDefault(hyper, "k", "Focus Window North", function() shell("wm-preset focus-window north; or wm-preset focus-floating-window north") end)
bindDefault(hyper, "l", "Focus Window East", function() shell("wm-preset focus-window east; or wm-preset focus-floating-window east") end)

-- Window swap/snap HJKL
bindDefault(hyperShift, "h", "Swap/Snap West", function() shell("if wm-preset is-window-floating; yabai-preset snap west; else; wm-preset swap-window west; end") end)
bindDefault(hyperShift, "j", "Swap/Snap South", function() shell("if wm-preset is-window-floating; yabai-preset snap south; else; wm-preset swap-window south; end") end)
bindDefault(hyperShift, "k", "Swap/Snap North", function() shell("if wm-preset is-window-floating; yabai-preset snap north; else; wm-preset swap-window north; end") end)
bindDefault(hyperShift, "l", "Swap/Snap East", function() shell("if wm-preset is-window-floating; yabai-preset snap east; else; wm-preset swap-window east; end") end)

-- Ctrl+Cmd HJKL (per-app, Chrome tab nav)
local function ctrlCmdHJKL(key, chromeKey, chromeMods, arrowDir)
  hs.hotkey.bind({"ctrl", "cmd"}, key, function()
    local app = frontAppName()
    if app == "Google Chrome" then
      local floating = shellSync("iterm-preset is-floating-window-active")
      if floating then
        hs.eventtap.keyStroke({"alt", "cmd"}, arrowDir)
      else
        hs.eventtap.keyStroke(chromeMods, chromeKey)
      end
    else
      hs.eventtap.keyStroke({"alt", "cmd"}, arrowDir)
    end
  end)
end

ctrlCmdHJKL("h", "tab", {"ctrl", "shift"}, "left")
ctrlCmdHJKL("j", "9",   {"cmd"},           "down")
ctrlCmdHJKL("k", "1",   {"cmd"},           "up")
ctrlCmdHJKL("l", "tab", {"ctrl"},          "right")

-- Shift+Ctrl+Cmd HJKL (per-app)
local function shiftCtrlCmdHJKL(key, chromeKey, chromeMods, arrowDir)
  hs.hotkey.bind({"shift", "ctrl", "cmd"}, key, function()
    local app = frontAppName()
    local floating = shellSync("iterm-preset is-floating-window-active")
    if app == "Google Chrome" then
      if floating then
        hs.eventtap.keyStroke({"ctrl", "cmd"}, arrowDir)
      else
        hs.eventtap.keyStroke(chromeMods, chromeKey)
      end
    elseif app == "iTerm2" then
      hs.eventtap.keyStroke({"ctrl", "cmd"}, arrowDir)
    else
      if floating then
        hs.eventtap.keyStroke({"ctrl", "cmd"}, arrowDir)
      else
        hs.eventtap.keyStroke({"shift", "alt", "cmd"}, arrowDir)
      end
    end
  end)
end

shiftCtrlCmdHJKL("h", "h", {"ctrl", "shift"}, "left")
shiftCtrlCmdHJKL("j", "j", {"ctrl", "shift"}, "down")
shiftCtrlCmdHJKL("k", "k", {"ctrl", "shift"}, "up")
shiftCtrlCmdHJKL("l", "l", {"ctrl", "shift"}, "right")

-- Resize
bindDefault(hyper, "-", "Resize Smart -100", function() shell("wm-preset resize smart -100") end)
bindDefault(hyper, "=", "Resize Smart +100", function() shell("wm-preset resize smart +100") end)

-- Harpoon 1-9
for i = 1, 9 do
  bindDefault(hyper, tostring(i), "Harpoon Focus " .. i, function() shell("yabai-harpoon focus " .. i) end)
end
bindDefault(hyperShift, "=", "Harpoon Add", function() shell("yabai-harpoon add") end)

-- Window cycling
bindDefault(hyper, "n", "Focus Next Window", function() shell("wm-preset focus-window next; or wm-preset focus-floating-window next") end)
bindDefault(hyper, "p", "Focus Prev Window", function() shell("wm-preset focus-window prev; or wm-preset focus-floating-window prev") end)
bindDefault(hyperShift, "n", "Move Window In Stack Next", function() shell("wm-preset move-window-in-stack next") end)
bindDefault(hyperShift, "p", "Move Window In Stack Prev", function() shell("wm-preset move-window-in-stack prev") end)

-- Mode entries
bindDefault(hyper, "space", "Enter Service Mode", function() service:enter() end)
bindDefault(hyper, "i", "Enter Invoke Mode", function() invoke:enter() end)
bindDefault(hyper, "'", "Enter Chrome Mode", function() chrome:enter() end)

-- App shortcuts
bindDefault(hyper, "b", "Focus BetterTouchTool", function() shell('wm-preset focus-app "BetterTouchTool"') end)
bindDefault(hyper, "c", "Focus Cursor", function() shell('wm-preset focus-app "Cursor"') end)
bindDefault(hyper, "x", "Focus iTerm2", function() shell('wm-preset focus-app "iTerm2"; and iterm-preset is-floating-window-active; and btt-preset send-keys cmd grave') end)
bindDefault(hyper, "q", "Focus Gemini", function() shell('chrome-preset focus-or-open-url "gemini.google.com" --label "Gemini"') end)
bindDefault(hyper, "w", "Focus WhatsApp", function() shell('wm-preset focus-app "WhatsApp"') end)
bindDefault(hyper, "z", "Focus Obsidian", function() shell('wm-preset focus-app "Obsidian"') end)
bindDefault(hyper, "s", "Toggle YouTube Music", function() shell('btt-preset alternate-app "YouTube Music" --hide') end)
bindDefault(hyper, "e", "Focus Chrome", function() shell('wm-preset focus-app "Google Chrome"') end)
bindDefault(hyper, "r", "Focus Chrome (alt)", function() shell('wm-preset focus-app "Google Chrome"') end)
bindDefault(hyper, "a", "Focus Timery", function() shell('wm-preset focus-app "Timery"') end)
bindDefault(hyperShift, "a", "Focus Pomofocus", function() shell('wm-preset focus-app "Pomofocus"') end)
bindDefault(hyperShift, "z", "Focus Google Keep", function() shell('wm-preset focus-app "Google Keep"') end)
bindDefault(hyperShift, "w", "Focus Zoom/Meet", function()
  shell('if pgrep "zoom.us" >/dev/null; wm-preset focus-app "zoom.us"; else; chrome-preset focus-or-open-url meet.google.com --label "Google Meet"; end')
end)
bindDefault(hyperShift, "s", "Toggle Mute Zoom/Meet", function()
  shell('if pgrep "zoom.us" >/dev/null; display-message "Toggle Mute"; wm-preset focus-app "zoom.us"; sleep 0.5; btt-preset send-keys cmd shift a; else; display-message "Toggle Mute"; chrome-preset focus-or-open-url meet.google.com --label "Google Meet"; sleep 0.5; btt-preset send-keys cmd d; end')
end)
bindDefault(hyperShift, "f", "Focus WhatsApp (shift)", function() shell('wm-preset focus-app "WhatsApp"') end)
bindDefault(hyperShift, "g", "Focus Messages", function() shell('wm-preset focus-app "Messages"') end)
bindDefault(hyperShift, "q", "Focus Activity Monitor", function() shell('wm-preset focus-app "Activity Monitor"') end)

bindDefault(hyper, "y", "Focus Calendar", function() shell('chrome-preset focus-or-open-url calendar.google.com --label "Calendar"') end)
bindDefault(hyper, "u", "Perform Default UI", function() shell("workflow-preset perform-default-ui") end)

-- Universal Actions (per-app)
bindDefault(hyper, "o", "Universal Actions", function()
  local app = frontAppName()
  if app == "iTerm2" then
    shell("ua --clipboard")
  else
    shell("ua")
  end
end)
bindDefault(hyperShift, "o", "Universal Actions (force)", function() shell("ua") end)

-- kindaVim toggle
bindDefault(hyperShift, "v", "Toggle kindaVim", function()
  shell('if pgrep "kindaVim" >/dev/null; display-message "Exit kindaVim"; killall "kindaVim"; else; display-message "Enter kindaVim"; open -a "kindaVim"; end')
end)

---------------------------------------------------------------
-- SERVICE MODE bindings
---------------------------------------------------------------

-- Neovide paste in service
bindModal(service, "Service: ", hyper, "v", "Neovide Paste", function() shell('btt-preset send-keys cmd c; and pbneovide --guess') end)

-- Harpoon
bindModal(service, "Service: ", {}, "a", "Harpoon Add", function() shell("yabai-harpoon add") end)
bindModal(service, "Service: ", {}, "delete", "Harpoon Delete", function() shell("yabai-harpoon delete") end)
bindModal(service, "Service: ", {}, "e", "Harpoon Edit", function() shell("yabai-harpoon edit") end)

-- Side-by-side
bindModal(service, "Service: ", {"shift"}, ";", "Side By Side", function() shell("yabai-preset side-by-side") end)

-- Edit skhd config (now hammerspoon keybindings)
bindModal(service, "Service: ", hyper, "e", "Edit Keybindings", function()
  shell('if pgrep -q -F "$TMPDIR/nvim_skhd.pid"; display-message "Focus SKHD"; neovim-ghost focus-or-new-tab "$HOME/.hammerspoon/keybindings.lua"; else; display-message "Edit SKHD"; fish -c \'neovim-ghost edit "$HOME/.hammerspoon/keybindings.lua"\' &; echo "$last_pid" > "$TMPDIR/nvim_skhd.pid"; wait; rm "$TMPDIR/nvim_skhd.pid"; end')
end)

-- Space focus
bindModal(service, "Service: ", hyper, "space", "Focus Space Recent", function() shell("wm-preset focus-space recent") end)
bindModal(service, "Service: ", {}, "space", "Focus Back And Forth", function() shell("wm-preset focus-back-and-forth") end)
bindModal(service, "Service: ", {"shift"}, "space", "Move Window To Space Recent", function() shell("wm-preset move-window-to-space recent") end)

-- Mode transitions
bindModal(service, "Service: ", {}, "r", "Enter Resize Mode", function() resize:enter() end)
bindModal(service, "Service: ", hyper, "r", "Enter Restart Mode", function() restart:enter() end)

-- Window management
bindModal(service, "Service: ", {"shift"}, "y", "Toggle WM", function() shell("wm-preset toggle-wm") end)
bindModal(service, "Service: ", {}, "v", "Insert Direction East", function() shell("wm-preset insert-direction east") end)
bindModal(service, "Service: ", {"shift"}, "'", "Insert Direction South", function() shell("wm-preset insert-direction south") end)
bindModal(service, "Service: ", {}, "t", "Toggle Float", function() shell('display-message (wm-preset toggle-float)') end)
bindModal(service, "Service: ", {}, "z", "Insert Direction Stack", function() shell("wm-preset insert-direction stack") end)
bindModal(service, "Service: ", {}, "s", "Insert Direction Stack (s)", function() shell("wm-preset insert-direction stack") end)
bindModal(service, "Service: ", {"shift"}, "s", "Stack Windows In Space", function() shell("wm-preset stack-windows-in-space") end)
bindModal(service, "Service: ", {}, "m", "Minimize After 3rd", function() shell("wm-preset minimize-after-nth-window 3") end)
bindModal(service, "Service: ", {"shift"}, "m", "Deminimize All", function() shell("wm-preset deminimize-all") end)
bindModal(service, "Service: ", {}, ",", "Layout Stack", function() shell("wm-preset layout-stack") end)
bindModal(service, "Service: ", {"shift"}, ",", "Layout BSP + Stack", function() shell("wm-preset layout-bsp; wm-preset stack-windows-in-space") end)
bindModal(service, "Service: ", {"shift"}, ".", "Layout BSP + Minimize", function() shell("wm-preset layout-bsp; wm-preset minimize-after-nth-window 3") end)
bindModal(service, "Service: ", {"shift"}, "t", "Layout Float", function() shell("wm-preset layout-float") end)
bindModal(service, "Service: ", {}, ".", "Layout BSP", function() shell("wm-preset layout-bsp") end)
bindModal(service, "Service: ", {}, "0", "Flatten", function() shell("wm-preset flatten") end)

-- Mirror / split / balance
bindModal(service, "Service: ", {"shift"}, "\\", "Mirror Y-Axis", function() shell("wm-preset mirror y-axis") end)
bindModal(service, "Service: ", {}, "-", "Mirror X-Axis", function() shell("wm-preset mirror x-axis") end)
bindModal(service, "Service: ", {}, "y", "Toggle Split", function() shell("wm-preset toggle-split") end)
bindModal(service, "Service: ", {}, "=", "Balance", function() shell("wm-preset balance") end)

-- Focus space 1-9
for i = 1, 9 do
  bindModal(service, "Service: ", {}, tostring(i), "Focus Space " .. i, function() shell("wm-preset focus-space " .. i) end)
end

-- Move window to space 1-9
for i = 1, 9 do
  bindModal(service, "Service: ", {"shift"}, tostring(i), "Move Window To Space " .. i, function() shell("wm-preset move-window-to-space " .. i) end)
end

-- Warp window HJKL
bindModal(service, "Service: ", hyper, "h", "Warp Window West", function() shell("wm-preset warp-window west") end)
bindModal(service, "Service: ", hyper, "j", "Warp Window South", function() shell("wm-preset warp-window south") end)
bindModal(service, "Service: ", hyper, "k", "Warp Window North", function() shell("wm-preset warp-window north") end)
bindModal(service, "Service: ", hyper, "l", "Warp Window East", function() shell("wm-preset warp-window east") end)

-- Focus display HJKL
bindModal(service, "Service: ", {}, "h", "Focus Display West", function() shell("wm-preset focus-display-with-fallback west") end)
bindModal(service, "Service: ", {}, "j", "Focus Display South", function() shell("wm-preset focus-display-with-fallback south") end)
bindModal(service, "Service: ", {}, "k", "Focus Display North", function() shell("wm-preset focus-display-with-fallback north") end)
bindModal(service, "Service: ", {}, "l", "Focus Display East", function() shell("wm-preset focus-display-with-fallback east") end)

-- Misc service
bindModal(service, "Service: ", {}, "tab", "Move Window To Next Display", function() shell("wm-preset smart-move-window-to-next-display") end)
bindModal(service, "Service: ", {"shift"}, "/", "Trigger Help Menu", function() shell("btt-preset trigger-menu-bar 'Help'") end)
bindModal(service, "Service: ", hyper, "/", "Search Mappings", showCommandPalette)
bindModal(service, "Service: ", {"shift"}, "v", "Tile Left", function() shell("btt-preset trigger-menu-bar 'Window;Full Screen Tile; Left of Screen'") end)
bindModal(service, "Service: ", hyper, "return", "True Fullscreen", function() shell("btt-preset send-keys ctrl cmd f") end)

-- Enter chrome from service
bindModal(service, "Service: ", {}, "c", "Enter Chrome Mode", function() chrome:enter() end)

---------------------------------------------------------------
-- RESIZE MODE bindings (stays in mode, no exit on key press)
---------------------------------------------------------------

resize:bind({}, "return", function() resize:exit() end)
resize:bind({}, "j", function() shell("wm-preset resize height +100") end)
resize:bind({}, "k", function() shell("wm-preset resize height -100") end)
resize:bind({}, "h", function() shell("wm-preset resize width -100") end)
resize:bind({}, "l", function() shell("wm-preset resize width +100") end)
resize:bind({"shift"}, "j", function() shell("wm-preset resize height +100") end)
resize:bind({"shift"}, "k", function() shell("wm-preset resize height -100") end)
resize:bind({"shift"}, "h", function() shell("wm-preset resize width -100") end)
resize:bind({"shift"}, "l", function() shell("wm-preset resize width +100") end)
resize:bind({"shift"}, ",", function() shell("wm-preset rotate 90") end)
resize:bind({"shift"}, ".", function() shell("wm-preset rotate 270") end)

---------------------------------------------------------------
-- RESTART MODE bindings
---------------------------------------------------------------

bindModal(restart, "Restart: ", hyper, "y", "Restart WM", function() shell("yabai-preset restart-wm") end)
bindModal(restart, "Restart: ", hyper, "b", "Restart BTT", function() hs.alert.show("Restart BTT"); shell("btt-preset restart-btt") end)
bindModal(restart, "Restart: ", hyper, "a", "Restart Alfred", function() hs.alert.show("Restart Alfred"); shell('killall Alfred; sleep 2; and open -a "Alfred 5"') end)
bindModal(restart, "Restart: ", hyper, "m", "Restart Mouseless", function() hs.alert.show("Restart Mouseless"); shell('killall mouseless; sleep 2; and open -a "Mouseless"') end)
bindModal(restart, "Restart: ", hyper, "v", "Restart NVIM Ghost", function() hs.alert.show("Restart NVIM Ghost"); shell("neovim-ghost kill; sleep 2; and neovim-ghost start") end)
bindModal(restart, "Restart: ", hyper, "k", "Restart Karabiner", function() hs.alert.show("Restart Karabiner"); shell('launchctl kickstart -k gui/(id -u)/org.pqrs.service.agent.karabiner_console_user_server') end)
bindModal(restart, "Restart: ", hyper, "s", "Toggle AeroSpace", function()
  shell('if pgrep -xq AeroSpace; display-message "Killing AeroSpace"; and killall AeroSpace; else; yabai-preset layout-float-all; display-message "Starting AeroSpace"; and open -a AeroSpace; end')
end)

---------------------------------------------------------------
-- CHROME MODE bindings
---------------------------------------------------------------

-- Mode transitions
bindModal(chrome, "Chrome: ", hyper, "'", "Enter Go To Mode", function() goto_mode:enter() end)
chrome:bind({}, "'", function() chrome:exit(); goto_mode:enter() end)

-- Close zoom tabs
bindModal(chrome, "Chrome: ", {}, "delete", "Close Zoom Tabs", function() shell([[chrome-preset close-tabs-with-url '^.*\.zoom\.us/j/.*$']]) end)

-- Focus pinned tab 1-9
for i = 1, 9 do
  bindModal(chrome, "Chrome: ", {}, tostring(i), "Focus Pinned Tab " .. i, function() shell("chrome-preset focus-pinned-tab " .. i) end)
end

-- Pin tab 1-9
for i = 1, 9 do
  bindModal(chrome, "Chrome: ", {"shift"}, tostring(i), "Pin Tab " .. i, function() shell("chrome-preset pin-tab " .. i) end)
end

-- Chrome URL shortcuts
bindModal(chrome, "Chrome: ", {}, "y", "YouTube", function() shell('chrome-preset focus-or-open-url --profile="Default" youtube.com') end)
bindModal(chrome, "Chrome: ", {}, "g", "Gmail", function() shell('chrome-preset focus-or-open-url --profile="Default" gmail.com') end)

---------------------------------------------------------------
-- GOTO MODE bindings
---------------------------------------------------------------

bindModal(goto_mode, "Go To: ", {}, "y", "YouTube (new tab)", function() shell('chrome-preset open-url --profile="Default" youtube.com') end)
bindModal(goto_mode, "Go To: ", {}, "g", "Gmail (new tab)", function() shell('chrome-preset open-url --profile="Default" gmail.com') end)

---------------------------------------------------------------
-- INVOKE MODE bindings
---------------------------------------------------------------

bindModal(invoke, "Invoke: ", {}, "1", "Arrange Work Spaces", function()
  shell([[wm-preset arrange-spaces -w '1:.*Thales \(Work\).*' -a '2:iTerm2' -a '3:.*VS Code.*' -a '4:Workchat' -a '5:Obsidian']])
end)
bindModal(invoke, "Invoke: ", {}, "p", "Arrange Personal Spaces", function()
  shell([[wm-preset arrange-spaces -w '7:.*Thales \(Personal\).*']])
end)
bindModal(invoke, "Invoke: ", {}, "b", "Alfred BTT Search", function() shell([[osascript -e 'tell application "Alfred" to search "btt "']]) end)
bindModal(invoke, "Invoke: ", {}, "t", "Alfred Top Search", function() shell([[osascript -e 'tell application "Alfred" to search "top "']]) end)
bindModal(invoke, "Invoke: ", {}, "y", "YouTube Search", function() shell("open 'raycast://extensions/tonka3000/youtube/search-videos?arguments=%7B%22query%22%3A%22%22%7D'") end)
bindModal(invoke, "Invoke: ", {}, "return", "New iTerm Window", function() shell("iterm-preset new-window") end)
bindModal(invoke, "Invoke: ", hyper, "i", "AI Input Mode", function() hs.alert.show("AI Input Mode"); shell('osascript -e "set volume input volume 100"; set-preferred-input-device') end)
bindModal(invoke, "Invoke: ", hyper, "r", "Reinitialize Displays", function() hs.alert.show("Reinitialize Displays"); shell("betterdisplaycli perform --reinitialize") end)

---------------------------------------------------------------
-- Apply local overrides
---------------------------------------------------------------

local ctx = {
  shell = shell,
  shellSync = shellSync,
  frontAppName = frontAppName,
  service = service,
  chrome = chrome,
  goto_mode = goto_mode,
  invoke = invoke,
  resize = resize,
  restart = restart,
  hyper = hyper,
  hyperShift = hyperShift,
  registerBinding = registerBinding,
  bindDefault = bindDefault,
  bindModal = bindModal,
}

if ok and localConfig and localConfig.setup then
  localConfig.setup(ctx)
end

---------------------------------------------------------------
-- Module return
---------------------------------------------------------------

return {
  service = service,
  chrome = chrome,
  goto_mode = goto_mode,
  invoke = invoke,
  resize = resize,
  restart = restart,
  hyper = hyper,
  hyperShift = hyperShift,
  shell = shell,
  showCommandPalette = showCommandPalette,
}
