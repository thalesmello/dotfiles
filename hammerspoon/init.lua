require("hs.ipc")

hs.hotkey.bind({"ctrl", "cmd", "alt"}, 'H', function() hs.toggleConsole() end)

function nonRecursiveBind(mods, key, callback)
  local hotkey
  hotkey = hs.hotkey.bind(mods, key, function()
    hotkey:disable()
    callback(mods, key)
    hotkey:enable()
  end)
end

function except(programName, callback)
  return function(mods, key)
    local currentName = hs.window.focusedWindow():application():name()
    if currentName == programName then
      hs.eventtap.keyStroke(mods, key)
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
