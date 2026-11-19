-- Compile saved Karabiner EDN asynchronously, without reloading Hammerspoon.
local shell = require("shell")
local util = require("util")
local M = {}
local instance

local function read(path)
  local file = io.open(path, "r")
  if not file then return nil end
  local content = file:read("*a")
  file:close()
  return content
end

function M.setup()
  if instance then instance.stop() end
  local path = os.getenv("HOME") .. "/.config/karabiner.edn"
  local target = hs.fs.pathToAbsolute(path) or path
  local function parent(p) return p:match("^(.*)/[^/]+$") end
  local dirs = {parent(path)}
  if parent(target) ~= dirs[1] then dirs[#dirs + 1] = parent(target) end
  local state = {last = read(path), watchers = {}, closed = false, running = false}
  instance = state
  local schedule

  local function compile()
    state.timer = nil
    if state.closed then return end
    if state.running then state.pending = true; return end
    local current = read(path)
    -- Ignore deletes, temporary files and generated JSON events. An atomic
    -- save will notify again after the replacement EDN is in place.
    if current == nil or current == state.last then return end
    state.running = true
    local task = shell.task({"goku", "-c", path}, function(ok)
      if state.closed then return end
      state.running, state.task = false, nil
      if ok then
        state.last = current
        util.log("Goku: Karabiner configuration updated")
      else
        util.log("Goku: compilation failed; check the Hammerspoon console")
        hs.alert.show("Goku failed: check the Hammerspoon console")
      end
      if state.pending then state.pending = false; schedule() end
    end)
    -- PATH discovery/startup failures may invoke the callback synchronously.
    if state.running then state.task = task end
  end

  schedule = function()
    if state.closed then return end
    if state.timer then state.timer:stop() end
    state.timer = hs.timer.doAfter(0.25, compile)
  end

  for _, dir in ipairs(dirs) do
    local watcher = hs.pathwatcher.new(dir, function(files)
      if state.closed then return end
      for _, file in ipairs(files) do
        if file == path or file == target or file == parent(path) or file == parent(target) then
          schedule()
          return
        end
      end
    end)
    if watcher then watcher:start(); state.watchers[#state.watchers + 1] = watcher end
  end

  function state.stop()
    state.closed = true
    if state.timer then state.timer:stop(); state.timer = nil end
    if state.task then state.task:terminate(); state.task = nil end
    for _, watcher in ipairs(state.watchers) do watcher:stop() end
  end
  return state
end

return M
