-- Reload saved Neru config changes without restarting the daemon.
local M = {}
local function content(dir)
  local parts = {}
  for _, name in ipairs({"config.toml", "config.override.toml"}) do
    local f = io.open(dir .. "/" .. name, "r")
    parts[#parts + 1] = name
    parts[#parts + 1] = f and f:read("*a") or "<missing>"
    if f then f:close() end
  end
  return table.concat(parts, "\0")
end

function M.start(reload)
  local path = os.getenv("HOME") .. "/.config/neru"
  local dir = hs.fs.pathToAbsolute(path) or path
  local state = {last = content(dir), closed = false}
  function state.markCurrent() state.last = content(dir) end
  local watcher = hs.pathwatcher.new(dir, function()
    if state.closed then return end
    if state.timer then state.timer:stop() end
    state.timer = hs.timer.doAfter(0.25, function()
      state.timer = nil
      if state.closed then return end
      local current = content(dir)
      if current ~= state.last then
        state.last = current
        reload()
      end
    end)
  end)
  if watcher then watcher:start() end
  function state.stop()
    state.closed = true
    if state.timer then state.timer:stop(); state.timer = nil end
    if watcher then watcher:stop() end
  end
  return state
end
return M
