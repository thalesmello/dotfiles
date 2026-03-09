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
-- Mode system
---------------------------------------------------------------

local Mode = {}
Mode.__index = Mode

function Mode:bindOnce(mods, key, name, fn)
  if self._modal then
    self._modal:bind(mods, key, function() self._modal:exit(); fn() end)
  else
    hs.hotkey.bind(mods, key, fn)
  end
  registerBinding(self._prefix .. name, fn)
end

function Mode:bind(mods, key, fn)
  if self._modal then
    self._modal:bind(mods, key, fn)
  else
    hs.hotkey.bind(mods, key, fn)
  end
end

function Mode:conditionalBind(mods, key, rules)
  self:bind(mods, key, function()
    local app = frontAppName()
    for _, rule in ipairs(rules) do
      local appMatch = not rule.app or rule.app == app
      local condMatch = not rule.cond or rule.cond()
      if appMatch and condMatch then
        rule[1]()
        return
      end
    end
  end)
end

function Mode:enter()
  if self._modal then self._modal:enter() end
end

function Mode:exit()
  if self._modal then self._modal:exit() end
end

local function createModal(name, prefix)
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
  return setmetatable({_modal = modal, _prefix = prefix or ""}, Mode)
end

local default   = setmetatable({_prefix = ""}, Mode)
local service   = createModal(nil, "Service: ")
local chrome    = createModal("Chrome", "Chrome: ")
local goto_mode = createModal("Go To", "Go To: ")
local invoke    = createModal("Invoke", "Invoke: ")
local resize    = createModal("Resize", "")
local restart   = createModal("Restart", "Restart: ")

---------------------------------------------------------------
-- Local config
---------------------------------------------------------------

local home = os.getenv("HOME")
local local_dotfiles = home .. "/.local_dotfiles"
package.path = local_dotfiles .. "/local_hammerspoon/?.lua;"
    .. local_dotfiles .. "/local_hammerspoon/?/init.lua;"
    .. package.path
local ok, localConfig = pcall(dofile, local_dotfiles .. "/local_hammerspoon/init.lua")

---------------------------------------------------------------
-- DEFAULT MODE bindings
---------------------------------------------------------------

-- Command palette
default:bindOnce(hyperShift, ";", "Command Palette", showCommandPalette)

-- Utility
default:bindOnce(hyperShift, "m", "Deminimize Last", function() shell("wm-preset deminimize-last") end)
default:bindOnce(hyper, "m", "Minimize", function() shell("wm-preset minimize") end)
default:bindOnce(hyper, "return", "Smart Toggle Fullscreen", function() shell("wm-preset smart-toggle-fullscreen") end)
default:bindOnce(hyperShift, "return", "Unstacked Swap Largest", function() shell("wm-preset unstacked-swap-largest") end)

-- Neovide / BTT
default:bindOnce(hyper, "v", "Neovide Toggle", function() shell('btt-preset alternate-app "Neovide" --hide --cmd "neovim-ghost trigger"') end)
default:bindOnce(hyper, "t", "Chrome: New Tab and Focus", function() shell('btt-preset trigger-named-trigger "Chrome: New Tab and Focus"') end)

-- Space navigation
default:bindOnce(hyper, "[", "Focus Space Prev", function() shell("wm-preset focus-space prev") end)
default:bindOnce(hyper, "]", "Focus Space Next", function() shell("wm-preset focus-space next") end)

-- Window focus HJKL
default:bindOnce(hyper, "h", "Focus Window West", function() shell("wm-preset focus-window west; or wm-preset focus-floating-window west") end)
default:bindOnce(hyper, "j", "Focus Window South", function() shell("wm-preset focus-window south; or wm-preset focus-floating-window south") end)
default:bindOnce(hyper, "k", "Focus Window North", function() shell("wm-preset focus-window north; or wm-preset focus-floating-window north") end)
default:bindOnce(hyper, "l", "Focus Window East", function() shell("wm-preset focus-window east; or wm-preset focus-floating-window east") end)

-- Window swap/snap HJKL
default:bindOnce(hyperShift, "h", "Swap/Snap West", function() shell("if wm-preset is-window-floating; yabai-preset snap west; else; wm-preset swap-window west; end") end)
default:bindOnce(hyperShift, "j", "Swap/Snap South", function() shell("if wm-preset is-window-floating; yabai-preset snap south; else; wm-preset swap-window south; end") end)
default:bindOnce(hyperShift, "k", "Swap/Snap North", function() shell("if wm-preset is-window-floating; yabai-preset snap north; else; wm-preset swap-window north; end") end)
default:bindOnce(hyperShift, "l", "Swap/Snap East", function() shell("if wm-preset is-window-floating; yabai-preset snap east; else; wm-preset swap-window east; end") end)

-- Ctrl+Cmd HJKL (per-app, Chrome tab nav)
local isFloating = function() return shellSync("iterm-preset is-floating-window-active") end

default:conditionalBind({"ctrl", "cmd"}, "h", {
  {app = "Google Chrome", cond = isFloating, function() hs.eventtap.keyStroke({"alt", "cmd"}, "left") end},
  {app = "Google Chrome", function() hs.eventtap.keyStroke({"ctrl", "shift"}, "tab") end},
  {function() hs.eventtap.keyStroke({"alt", "cmd"}, "left") end},
})
default:conditionalBind({"ctrl", "cmd"}, "j", {
  {app = "Google Chrome", cond = isFloating, function() hs.eventtap.keyStroke({"alt", "cmd"}, "down") end},
  {app = "Google Chrome", function() hs.eventtap.keyStroke({"cmd"}, "9") end},
  {function() hs.eventtap.keyStroke({"alt", "cmd"}, "down") end},
})
default:conditionalBind({"ctrl", "cmd"}, "k", {
  {app = "Google Chrome", cond = isFloating, function() hs.eventtap.keyStroke({"alt", "cmd"}, "up") end},
  {app = "Google Chrome", function() hs.eventtap.keyStroke({"cmd"}, "1") end},
  {function() hs.eventtap.keyStroke({"alt", "cmd"}, "up") end},
})
default:conditionalBind({"ctrl", "cmd"}, "l", {
  {app = "Google Chrome", cond = isFloating, function() hs.eventtap.keyStroke({"alt", "cmd"}, "right") end},
  {app = "Google Chrome", function() hs.eventtap.keyStroke({"ctrl"}, "tab") end},
  {function() hs.eventtap.keyStroke({"alt", "cmd"}, "right") end},
})

-- Shift+Ctrl+Cmd HJKL (per-app)
default:conditionalBind({"shift", "ctrl", "cmd"}, "h", {
  {app = "Google Chrome", cond = isFloating, function() hs.eventtap.keyStroke({"ctrl", "cmd"}, "left") end},
  {app = "Google Chrome", function() hs.eventtap.keyStroke({"ctrl", "shift"}, "h") end},
  {app = "iTerm2", function() hs.eventtap.keyStroke({"ctrl", "cmd"}, "left") end},
  {cond = isFloating, function() hs.eventtap.keyStroke({"ctrl", "cmd"}, "left") end},
  {function() hs.eventtap.keyStroke({"shift", "alt", "cmd"}, "left") end},
})
default:conditionalBind({"shift", "ctrl", "cmd"}, "j", {
  {app = "Google Chrome", cond = isFloating, function() hs.eventtap.keyStroke({"ctrl", "cmd"}, "down") end},
  {app = "Google Chrome", function() hs.eventtap.keyStroke({"ctrl", "shift"}, "j") end},
  {app = "iTerm2", function() hs.eventtap.keyStroke({"ctrl", "cmd"}, "down") end},
  {cond = isFloating, function() hs.eventtap.keyStroke({"ctrl", "cmd"}, "down") end},
  {function() hs.eventtap.keyStroke({"shift", "alt", "cmd"}, "down") end},
})
default:conditionalBind({"shift", "ctrl", "cmd"}, "k", {
  {app = "Google Chrome", cond = isFloating, function() hs.eventtap.keyStroke({"ctrl", "cmd"}, "up") end},
  {app = "Google Chrome", function() hs.eventtap.keyStroke({"ctrl", "shift"}, "k") end},
  {app = "iTerm2", function() hs.eventtap.keyStroke({"ctrl", "cmd"}, "up") end},
  {cond = isFloating, function() hs.eventtap.keyStroke({"ctrl", "cmd"}, "up") end},
  {function() hs.eventtap.keyStroke({"shift", "alt", "cmd"}, "up") end},
})
default:conditionalBind({"shift", "ctrl", "cmd"}, "l", {
  {app = "Google Chrome", cond = isFloating, function() hs.eventtap.keyStroke({"ctrl", "cmd"}, "right") end},
  {app = "Google Chrome", function() hs.eventtap.keyStroke({"ctrl", "shift"}, "l") end},
  {app = "iTerm2", function() hs.eventtap.keyStroke({"ctrl", "cmd"}, "right") end},
  {cond = isFloating, function() hs.eventtap.keyStroke({"ctrl", "cmd"}, "right") end},
  {function() hs.eventtap.keyStroke({"shift", "alt", "cmd"}, "right") end},
})

-- Resize
default:bindOnce(hyper, "-", "Resize Smart -100", function() shell("wm-preset resize smart -100") end)
default:bindOnce(hyper, "=", "Resize Smart +100", function() shell("wm-preset resize smart +100") end)

-- Harpoon 1-9
for i = 1, 9 do
  default:bindOnce(hyper, tostring(i), "Harpoon Focus " .. i, function() shell("yabai-harpoon focus " .. i) end)
end
default:bindOnce(hyperShift, "=", "Harpoon Add", function() shell("yabai-harpoon add") end)

-- Window cycling
default:bindOnce(hyper, "n", "Focus Next Window", function() shell("wm-preset focus-window next; or wm-preset focus-floating-window next") end)
default:bindOnce(hyper, "p", "Focus Prev Window", function() shell("wm-preset focus-window prev; or wm-preset focus-floating-window prev") end)
default:bindOnce(hyperShift, "n", "Move Window In Stack Next", function() shell("wm-preset move-window-in-stack next") end)
default:bindOnce(hyperShift, "p", "Move Window In Stack Prev", function() shell("wm-preset move-window-in-stack prev") end)

-- Mode entries
default:bindOnce(hyper, "space", "Enter Service Mode", function() service:enter() end)
default:bindOnce(hyper, "i", "Enter Invoke Mode", function() invoke:enter() end)
default:bindOnce(hyper, "'", "Enter Chrome Mode", function() chrome:enter() end)

-- App shortcuts
default:bindOnce(hyper, "b", "Focus BetterTouchTool", function() shell('wm-preset focus-app "BetterTouchTool"') end)
default:bindOnce(hyper, "c", "Focus Cursor", function() shell('wm-preset focus-app "Cursor"') end)
default:bindOnce(hyper, "x", "Focus iTerm2", function() shell('wm-preset focus-app "iTerm2"; and iterm-preset is-floating-window-active; and btt-preset send-keys cmd grave') end)
default:bindOnce(hyper, "q", "Focus Gemini", function() shell('chrome-preset focus-or-open-url "gemini.google.com" --label "Gemini"') end)
default:bindOnce(hyper, "w", "Focus WhatsApp", function() shell('wm-preset focus-app "WhatsApp"') end)
default:bindOnce(hyper, "z", "Focus Obsidian", function() shell('wm-preset focus-app "Obsidian"') end)
default:bindOnce(hyper, "s", "Toggle YouTube Music", function() shell('btt-preset alternate-app "YouTube Music" --hide') end)
default:bindOnce(hyper, "e", "Focus Chrome", function() shell('wm-preset focus-app "Google Chrome"') end)
default:bindOnce(hyper, "r", "Focus Chrome (alt)", function() shell('wm-preset focus-app "Google Chrome"') end)
default:bindOnce(hyper, "a", "Focus Timery", function() shell('wm-preset focus-app "Timery"') end)
default:bindOnce(hyperShift, "a", "Focus Pomofocus", function() shell('wm-preset focus-app "Pomofocus"') end)
default:bindOnce(hyperShift, "z", "Focus Google Keep", function() shell('wm-preset focus-app "Google Keep"') end)
default:bindOnce(hyperShift, "w", "Focus Zoom/Meet", function()
  shell('if pgrep "zoom.us" >/dev/null; wm-preset focus-app "zoom.us"; else; chrome-preset focus-or-open-url meet.google.com --label "Google Meet"; end')
end)
default:bindOnce(hyperShift, "s", "Toggle Mute Zoom/Meet", function()
  shell('if pgrep "zoom.us" >/dev/null; display-message "Toggle Mute"; wm-preset focus-app "zoom.us"; sleep 0.5; btt-preset send-keys cmd shift a; else; display-message "Toggle Mute"; chrome-preset focus-or-open-url meet.google.com --label "Google Meet"; sleep 0.5; btt-preset send-keys cmd d; end')
end)
default:bindOnce(hyperShift, "f", "Focus WhatsApp (shift)", function() shell('wm-preset focus-app "WhatsApp"') end)
default:bindOnce(hyperShift, "g", "Focus Messages", function() shell('wm-preset focus-app "Messages"') end)
default:bindOnce(hyperShift, "q", "Focus Activity Monitor", function() shell('wm-preset focus-app "Activity Monitor"') end)

default:bindOnce(hyper, "y", "Focus Calendar", function() shell('chrome-preset focus-or-open-url calendar.google.com --label "Calendar"') end)
default:bindOnce(hyper, "u", "Perform Default UI", function() shell("workflow-preset perform-default-ui") end)

-- Universal Actions (per-app)
default:bindOnce(hyper, "o", "Universal Actions", function()
  local app = frontAppName()
  if app == "iTerm2" then
    shell("ua --clipboard")
  else
    shell("ua")
  end
end)
default:bindOnce(hyperShift, "o", "Universal Actions (force)", function() shell("ua") end)

-- kindaVim toggle
default:bindOnce(hyperShift, "v", "Toggle kindaVim", function()
  shell('if pgrep "kindaVim" >/dev/null; display-message "Exit kindaVim"; killall "kindaVim"; else; display-message "Enter kindaVim"; open -a "kindaVim"; end')
end)

---------------------------------------------------------------
-- SERVICE MODE bindings
---------------------------------------------------------------

-- Neovide paste in service
service:bindOnce(hyper, "v", "Neovide Paste", function() shell('btt-preset send-keys cmd c; and pbneovide --guess') end)

-- Harpoon
service:bindOnce({}, "a", "Harpoon Add", function() shell("yabai-harpoon add") end)
service:bindOnce({}, "delete", "Harpoon Delete", function() shell("yabai-harpoon delete") end)
service:bindOnce({}, "e", "Harpoon Edit", function() shell("yabai-harpoon edit") end)

-- Side-by-side
service:bindOnce({"shift"}, ";", "Side By Side", function() shell("yabai-preset side-by-side") end)

-- Edit skhd config (now hammerspoon keybindings)
service:bindOnce(hyper, "e", "Edit Keybindings", function()
  shell('if pgrep -q -F "$TMPDIR/nvim_skhd.pid"; display-message "Focus SKHD"; neovim-ghost focus-or-new-tab "$HOME/.hammerspoon/keybindings.lua"; else; display-message "Edit SKHD"; fish -c \'neovim-ghost edit "$HOME/.hammerspoon/keybindings.lua"\' &; echo "$last_pid" > "$TMPDIR/nvim_skhd.pid"; wait; rm "$TMPDIR/nvim_skhd.pid"; end')
end)

-- Space focus
service:bindOnce(hyper, "space", "Focus Space Recent", function() shell("wm-preset focus-space recent") end)
service:bindOnce({}, "space", "Focus Back And Forth", function() shell("wm-preset focus-back-and-forth") end)
service:bindOnce({"shift"}, "space", "Move Window To Space Recent", function() shell("wm-preset move-window-to-space recent") end)

-- Mode transitions
service:bindOnce({}, "r", "Enter Resize Mode", function() resize:enter() end)
service:bindOnce(hyper, "r", "Enter Restart Mode", function() restart:enter() end)

-- Window management
service:bindOnce({"shift"}, "y", "Toggle WM", function() shell("wm-preset toggle-wm") end)
service:bindOnce({}, "v", "Insert Direction East", function() shell("wm-preset insert-direction east") end)
service:bindOnce({"shift"}, "'", "Insert Direction South", function() shell("wm-preset insert-direction south") end)
service:bindOnce({}, "t", "Toggle Float", function() shell('display-message (wm-preset toggle-float)') end)
service:bindOnce({}, "z", "Insert Direction Stack", function() shell("wm-preset insert-direction stack") end)
service:bindOnce({}, "s", "Insert Direction Stack (s)", function() shell("wm-preset insert-direction stack") end)
service:bindOnce({"shift"}, "s", "Stack Windows In Space", function() shell("wm-preset stack-windows-in-space") end)
service:bindOnce({}, "m", "Minimize After 3rd", function() shell("wm-preset minimize-after-nth-window 3") end)
service:bindOnce({"shift"}, "m", "Deminimize All", function() shell("wm-preset deminimize-all") end)
service:bindOnce({}, ",", "Layout Stack", function() shell("wm-preset layout-stack") end)
service:bindOnce({"shift"}, ",", "Layout BSP + Stack", function() shell("wm-preset layout-bsp; wm-preset stack-windows-in-space") end)
service:bindOnce({"shift"}, ".", "Layout BSP + Minimize", function() shell("wm-preset layout-bsp; wm-preset minimize-after-nth-window 3") end)
service:bindOnce({"shift"}, "t", "Layout Float", function() shell("wm-preset layout-float") end)
service:bindOnce({}, ".", "Layout BSP", function() shell("wm-preset layout-bsp") end)
service:bindOnce({}, "0", "Flatten", function() shell("wm-preset flatten") end)

-- Mirror / split / balance
service:bindOnce({"shift"}, "\\", "Mirror Y-Axis", function() shell("wm-preset mirror y-axis") end)
service:bindOnce({}, "-", "Mirror X-Axis", function() shell("wm-preset mirror x-axis") end)
service:bindOnce({}, "y", "Toggle Split", function() shell("wm-preset toggle-split") end)
service:bindOnce({}, "=", "Balance", function() shell("wm-preset balance") end)

-- Focus space 1-9
for i = 1, 9 do
  service:bindOnce({}, tostring(i), "Focus Space " .. i, function() shell("wm-preset focus-space " .. i) end)
end

-- Move window to space 1-9
for i = 1, 9 do
  service:bindOnce({"shift"}, tostring(i), "Move Window To Space " .. i, function() shell("wm-preset move-window-to-space " .. i) end)
end

-- Warp window HJKL
service:bindOnce(hyper, "h", "Warp Window West", function() shell("wm-preset warp-window west") end)
service:bindOnce(hyper, "j", "Warp Window South", function() shell("wm-preset warp-window south") end)
service:bindOnce(hyper, "k", "Warp Window North", function() shell("wm-preset warp-window north") end)
service:bindOnce(hyper, "l", "Warp Window East", function() shell("wm-preset warp-window east") end)

-- Focus display HJKL
service:bindOnce({}, "h", "Focus Display West", function() shell("wm-preset focus-display-with-fallback west") end)
service:bindOnce({}, "j", "Focus Display South", function() shell("wm-preset focus-display-with-fallback south") end)
service:bindOnce({}, "k", "Focus Display North", function() shell("wm-preset focus-display-with-fallback north") end)
service:bindOnce({}, "l", "Focus Display East", function() shell("wm-preset focus-display-with-fallback east") end)

-- Misc service
service:bindOnce({}, "tab", "Move Window To Next Display", function() shell("wm-preset smart-move-window-to-next-display") end)
service:bindOnce({"shift"}, "/", "Trigger Help Menu", function() shell("btt-preset trigger-menu-bar 'Help'") end)
service:bindOnce(hyper, "/", "Search Mappings", showCommandPalette)
service:bindOnce({"shift"}, "v", "Tile Left", function() shell("btt-preset trigger-menu-bar 'Window;Full Screen Tile; Left of Screen'") end)
service:bindOnce(hyper, "return", "True Fullscreen", function() shell("btt-preset send-keys ctrl cmd f") end)

-- Enter chrome from service
service:bindOnce({}, "c", "Enter Chrome Mode", function() chrome:enter() end)

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

restart:bindOnce(hyper, "y", "Restart WM", function() shell("yabai-preset restart-wm") end)
restart:bindOnce(hyper, "b", "Restart BTT", function() hs.alert.show("Restart BTT"); shell("btt-preset restart-btt") end)
restart:bindOnce(hyper, "a", "Restart Alfred", function() hs.alert.show("Restart Alfred"); shell('killall Alfred; sleep 2; and open -a "Alfred 5"') end)
restart:bindOnce(hyper, "m", "Restart Mouseless", function() hs.alert.show("Restart Mouseless"); shell('killall mouseless; sleep 2; and open -a "Mouseless"') end)
restart:bindOnce(hyper, "v", "Restart NVIM Ghost", function() hs.alert.show("Restart NVIM Ghost"); shell("neovim-ghost kill; sleep 2; and neovim-ghost start") end)
restart:bindOnce(hyper, "k", "Restart Karabiner", function() hs.alert.show("Restart Karabiner"); shell('launchctl kickstart -k gui/(id -u)/org.pqrs.service.agent.karabiner_console_user_server') end)
restart:bindOnce(hyper, "s", "Toggle AeroSpace", function()
  shell('if pgrep -xq AeroSpace; display-message "Killing AeroSpace"; and killall AeroSpace; else; yabai-preset layout-float-all; display-message "Starting AeroSpace"; and open -a AeroSpace; end')
end)

---------------------------------------------------------------
-- CHROME MODE bindings
---------------------------------------------------------------

-- Mode transitions
chrome:bindOnce(hyper, "'", "Enter Go To Mode", function() goto_mode:enter() end)
chrome:bind({}, "'", function() chrome:exit(); goto_mode:enter() end)

-- Close zoom tabs
chrome:bindOnce({}, "delete", "Close Zoom Tabs", function() shell([[chrome-preset close-tabs-with-url '^.*\.zoom\.us/j/.*$']]) end)

-- Focus pinned tab 1-9
for i = 1, 9 do
  chrome:bindOnce({}, tostring(i), "Focus Pinned Tab " .. i, function() shell("chrome-preset focus-pinned-tab " .. i) end)
end

-- Pin tab 1-9
for i = 1, 9 do
  chrome:bindOnce({"shift"}, tostring(i), "Pin Tab " .. i, function() shell("chrome-preset pin-tab " .. i) end)
end

-- Chrome URL shortcuts
chrome:bindOnce({}, "y", "YouTube", function() shell('chrome-preset focus-or-open-url --profile="Default" youtube.com') end)
chrome:bindOnce({}, "g", "Gmail", function() shell('chrome-preset focus-or-open-url --profile="Default" gmail.com') end)

---------------------------------------------------------------
-- GOTO MODE bindings
---------------------------------------------------------------

goto_mode:bindOnce({}, "y", "YouTube (new tab)", function() shell('chrome-preset open-url --profile="Default" youtube.com') end)
goto_mode:bindOnce({}, "g", "Gmail (new tab)", function() shell('chrome-preset open-url --profile="Default" gmail.com') end)

---------------------------------------------------------------
-- INVOKE MODE bindings
---------------------------------------------------------------

invoke:bindOnce({}, "1", "Arrange Work Spaces", function()
  shell([[wm-preset arrange-spaces -w '1:.*Thales \(Work\).*' -a '2:iTerm2' -a '3:.*VS Code.*' -a '4:Workchat' -a '5:Obsidian']])
end)
invoke:bindOnce({}, "p", "Arrange Personal Spaces", function()
  shell([[wm-preset arrange-spaces -w '7:.*Thales \(Personal\).*']])
end)
invoke:bindOnce({}, "b", "Alfred BTT Search", function() shell([[osascript -e 'tell application "Alfred" to search "btt "']]) end)
invoke:bindOnce({}, "t", "Alfred Top Search", function() shell([[osascript -e 'tell application "Alfred" to search "top "']]) end)
invoke:bindOnce({}, "y", "YouTube Search", function() shell("open 'raycast://extensions/tonka3000/youtube/search-videos?arguments=%7B%22query%22%3A%22%22%7D'") end)
invoke:bindOnce({}, "return", "New iTerm Window", function() shell("iterm-preset new-window") end)
invoke:bindOnce(hyper, "i", "AI Input Mode", function() hs.alert.show("AI Input Mode"); shell('osascript -e "set volume input volume 100"; set-preferred-input-device') end)
invoke:bindOnce(hyper, "r", "Reinitialize Displays", function() hs.alert.show("Reinitialize Displays"); shell("betterdisplaycli perform --reinitialize") end)

---------------------------------------------------------------
-- Apply local overrides
---------------------------------------------------------------

local ctx = {
  shell = shell,
  shellSync = shellSync,
  frontAppName = frontAppName,
  default = default,
  service = service,
  chrome = chrome,
  goto_mode = goto_mode,
  invoke = invoke,
  resize = resize,
  restart = restart,
  hyper = hyper,
  hyperShift = hyperShift,
  registerBinding = registerBinding,
  Mode = Mode,
}

if ok and localConfig and localConfig.setup then
  localConfig.setup(ctx)
end

---------------------------------------------------------------
-- Module return
---------------------------------------------------------------

return {
  default = default,
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
  Mode = Mode,
}
