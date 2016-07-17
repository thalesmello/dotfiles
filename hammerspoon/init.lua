require("hs.ipc")
local mash = {"ctrl", "cmd"}

hs.hotkey.bind({"ctrl", "cmd", "alt"}, 'H', function() hs.toggleConsole() end)

hs.hotkey.bind({"ctrl", "cmd", "shift"}, 'h', function() hs.window.focusedWindow():focusWindowWest()  end)
hs.hotkey.bind({"ctrl", "cmd", "shift"}, 'j', function() hs.window.focusedWindow():focusWindowSouth() end)
hs.hotkey.bind({"ctrl", "cmd", "shift"}, 'k', function() hs.window.focusedWindow():focusWindowNorth() end)
hs.hotkey.bind({"ctrl", "cmd", "shift"}, 'L', function() hs.window.focusedWindow():focusWindowEast()  end)

function notify(str)
  hs.notify.new({title="Hammerspoon", informativeText=str}):send()
end

function send_raw_keys(mods, key)
  local hotkeys = hs.hotkey.getHotkeys()
  for _, hotkey in ipairs(hotkeys) do
    hotkey:disable()
  end
  hs.eventtap.keyStroke(mods, key)
  for _, hotkey in ipairs(hotkeys) do
    hotkey:enable()
  end
end

function hs.ipc.handler(str)
  if str == 'focusleft' then
    hs.window.focusedWindow():focusWindowWest()
  elseif str == 'focusdown' then
    hs.window.focusedWindow():focusWindowSouth()
  elseif str == 'focusup' then
    hs.window.focusedWindow():focusWindowNorth()
  elseif str == 'focusright' then
    hs.window.focusedWindow():focusWindowEast()
  elseif str == 'currentapp' then
    return hs.window.focusedWindow():application():name()
  elseif str == 'ctrl_h' then
    send_raw_keys({"ctrl"}, "h")
  elseif str == 'ctrl_j' then
    send_raw_keys({"ctrl"}, "j")
  elseif str == 'ctrl_k' then
    send_raw_keys({"ctrl"}, "k")
  elseif str == 'ctrl_l' then
    send_raw_keys({"ctrl"}, "l")
  end
end

-- Reload file
function reloadConfig(files)
  for _, file in pairs(files) do
    if file:sub(-4) == '.lua' then
      hs.notify.new({title="Change detected", informativeText="Reloading Hammerspoon"}):send()
      hs.reload()
    end
  end
end

hs.pathwatcher.new(os.getenv('HOME') .. '/.hammerspoon/', reloadConfig):start()
