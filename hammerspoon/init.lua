require("hs.ipc")

hs.hotkey.bind({"ctrl", "cmd", "alt"}, 'H', function() hs.toggleConsole() end)

hs.hotkey.bind({"ctrl", "cmd", "shift"}, 'h', function() hs.window.focusedWindow():focusWindowWest()  end)
hs.hotkey.bind({"ctrl", "cmd", "shift"}, 'j', function() hs.window.focusedWindow():focusWindowSouth() end)
hs.hotkey.bind({"ctrl", "cmd", "shift"}, 'k', function() hs.window.focusedWindow():focusWindowNorth() end)
hs.hotkey.bind({"ctrl", "cmd", "shift"}, 'L', function() hs.window.focusedWindow():focusWindowEast()  end)
hs.hotkey.bind({"ctrl", "cmd"}, 'H', function() hs.eventtap.keyStroke({"ctrl"}, "left") end)
hs.hotkey.bind({"ctrl", "cmd"}, 'L', function() hs.eventtap.keyStroke({"ctrl"}, "right") end)

function notify(str)
  hs.notify.new({title="Hammerspoon", informativeText=str}):send()
end

-- Reload file
function reloadConfig(files)
  for _, file in pairs(files) do
    if file:sub(-4) == '.lua' then
      notify("Change detected: Reloading")
      hs.reload()
    end
  end
end

hs.pathwatcher.new(os.getenv('HOME') .. '/.hammerspoon/', reloadConfig):start()
