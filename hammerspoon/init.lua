require("hs.ipc")
local mash = {"ctrl", "cmd"}

hs.hotkey.bind({"ctrl"}, 'H', function() hs.execute('../bin/octomux os left') end)
hs.hotkey.bind({"ctrl"}, 'L', function() hs.execute('../bin/octomux os right') end)
hs.hotkey.bind({"ctrl"}, 'K', function() hs.execute('../bin/octomux os up') end)
hs.hotkey.bind({"ctrl"}, 'J', function() hs.execute('../bin/octomux os down') end)

hs.hotkey.bind({"ctrl", "cmd", "shift"}, 'D', function() hs.execute('say -v luciana O Devlindo é muito DDQ') end)
hs.hotkey.bind({"ctrl", "cmd", "shift"}, 'B', function() hs.execute('say birl') end)
hs.hotkey.bind({"ctrl", "cmd", "shift"}, 'H', function() hs.eventtap.keyStroke({"ctrl"}, "left") end)
hs.hotkey.bind({"ctrl", "cmd", "shift"}, 'L', function() hs.eventtap.keyStroke({"ctrl"}, "right") end)
hs.hotkey.bind(mash, 'T', function() hs.notify.new({title="Hammerspoon", informativeText=hs.window.focusedWindow():application():name()}):send() end)

function notify(str)
  hs.notify.new({title="Hammerspoon", informativeText=str}):send()
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
    hs.eventtap.keyStroke("h")
  elseif str == 'ctrl_j' then
    hs.eventtap.keyStroke("j")
  elseif str == 'ctrl_k' then
    hs.eventtap.keyStroke("k")
  elseif str == 'ctrl_l' then
    hs.eventtap.keyStroke("l")
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
