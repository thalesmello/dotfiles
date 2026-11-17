local realOpen = io.open
local files = {["/config/config.toml"] = "initial"}
io.open = function(path)
  if not files[path] then return nil end
  return {read = function() return files[path] end, close = function() end}
end
local callback, timer, stopped
hs = {
  fs = {pathToAbsolute = function() return "/config" end},
  pathwatcher = {new = function(_, fn)
    callback = fn
    return {start = function() end, stop = function() stopped = true end}
  end},
  timer = {doAfter = function(delay, fn)
    assert(delay == 0.25)
    timer = {fn = fn, stop = function(self) self.stopped = true end}
    return timer
  end},
}
local module = dofile("stow_modules/main/dot-hammerspoon/neruConfigWatcher.lua")
local reloads = 0
local watcher = module.start(function() reloads = reloads + 1 end)
callback(); timer.fn(); assert(reloads == 0)
files["/config/config.toml"] = "edited"
callback(); local previous = timer; callback(); assert(previous.stopped)
timer.fn(); assert(reloads == 1)
files["/config/config.toml.layout.tmp"] = "temporary"
callback(); timer.fn(); assert(reloads == 1)
files["/config/config.toml"] = "layout picker write"
watcher.markCurrent(); callback(); timer.fn(); assert(reloads == 1)
files["/config/config.override.toml"] = "override"
callback(); timer.fn(); assert(reloads == 2)
callback(); watcher.stop(); assert(stopped and timer.stopped)
timer.fn(); assert(reloads == 2)
io.open = realOpen
print("Neru config watcher checks passed")
