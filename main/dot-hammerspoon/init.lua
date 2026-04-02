hs.loadSpoon("EmmyLua")
require("hs.ipc")
local util = require('util')

local hyperShift = {"ctrl", "cmd", "alt", "shift"}
local hyper = {"ctrl", "cmd", "shift"}

hs.console.darkMode(true)

hs.hotkey.bind(hyperShift, 'B', function() hs.toggleConsole() end)

if not hs.ipc.cliStatus(nil, true) then
  hs.ipc.cliInstall()
end

Preset = require("preset")
require("keybindings")
require("audiodevice")
require("screenwatcher")

-- Auto-reload config when files change
-- Resolve symlinks so FSEvents watches the real directory
local function resolvePath(path)
  return hs.fs.pathToAbsolute(path) or path
end

local watchPaths = {
  resolvePath(os.getenv("HOME") .. "/.hammerspoon"),
  resolvePath(os.getenv("HOME") .. "/.local_dotfiles/local_hammerspoon"),
}

_G.ReloadFileListeners = {}
for _, path in ipairs(watchPaths) do
  local watcher = hs.pathwatcher.new(path, function(files)
    local luaFiles = hs.fnutils.filter(files, function(f) return f:match("%.lua$") end)
    if not luaFiles or #luaFiles == 0 then return end

    for _, file in ipairs(luaFiles) do
      local fn, err = loadfile(file)
      if not fn then
        util.log("Syntax error in " .. file .. ": " .. err)
        hs.alert.show("Syntax error in " .. file:match("[^/]+$"))
        return
      end
    end

    util.log("Reloading config")
    hs.reload()
  end)
  if watcher then
    watcher:start()
    table.insert(ReloadFileListeners, watcher)
  end
end

-- -- Restart watchers on wake to prevent stale FSEvents streams
-- local wakeWatcher = hs.caffeinate.watcher.new(function(event)
--   if event == hs.caffeinate.watcher.systemDidWake then
--     for _, w in ipairs(reloadWatchers) do
--       w:stop()
--       w:start()
--     end
--   end
-- end)
-- wakeWatcher:start()

local DEBUG = false
if DEBUG then
  local logPath = "/tmp/hammerspoon.log"
  local logFile = io.open(logPath, "a")

  if logFile then
    logFile:setvbuf("line")
    local oldPrint = print
    print = function(...)
      logFile:write(table.concat({...}, "\t") .. "\n")
      logFile:flush() -- Ensure it writes immediately
      oldPrint(...) -- Also print to the Console
    end
  end
end

util.notify("Hammerspoon!")

