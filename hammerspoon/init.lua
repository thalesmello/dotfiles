require("hs.ipc")

if not hs.ipc.cliStatus(null, true) then
  hs.ipc.cliInstall()
end

function nonRecursiveBind(mods, key, callback)
  local hotkey
  hotkey = hs.hotkey.bind(mods, key, function()
    callback(hotkey, mods, key)
  end)
end

function except(programName, callback)
  return function(hotkey, mods, key)
    local currentName = hs.window.focusedWindow():application():name()
    if currentName == programName then
      hotkey:disable()
      hs.eventtap.keyStroke(mods, key)
      hotkey:enable()
    else
      callback()
    end
  end
end

nonRecursiveBind({"ctrl"}, "H", except("iTerm2", function() hs.window.focusedWindow():focusWindowWest()  end))
nonRecursiveBind({"ctrl"}, "J", except("iTerm2", function() hs.window.focusedWindow():focusWindowSouth() end))
nonRecursiveBind({"ctrl"}, "K", except("iTerm2", function() hs.window.focusedWindow():focusWindowNorth() end))
nonRecursiveBind({"ctrl"}, "L", except("iTerm2", function() hs.window.focusedWindow():focusWindowEast()  end))

hs.hotkey.bind({"ctrl", "cmd"}, 'H', function() hs.eventtap.keyStroke({"ctrl"}, "left") end)
hs.hotkey.bind({"ctrl", "cmd"}, 'L', function() hs.eventtap.keyStroke({"ctrl"}, "right") end)



hs.hotkey.bind({"ctrl", "cmd", "alt"}, 'H', function() hs.toggleConsole() end)


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

-- Utils
function notify(str)
  hs.notify.new({title="Hammerspoon", informativeText=str}):send()
end
