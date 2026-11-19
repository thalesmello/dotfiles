-- Track readiness from the reload request, not just evaluation of init.lua.
local M = {}
local KEY = "hammerspoon.reloadRequestedAt"
local originalReload = hs.reload
local clock = hs.timer.absoluteTime

function M.begin(startedNs)
  local startup = {}
  local requestedMs = hs.settings.get(KEY)
  if requestedMs ~= nil then hs.settings.clear(KEY) end
  if type(requestedMs) == "number" then
    local elapsed = startedNs / 1e6 - requestedMs
    -- Discard stale requests after a crash/app restart, or an invalid clock.
    if elapsed >= 0 and elapsed < 10000 then startup.beforeInitMs = elapsed end
  end
  hs.reload = function(...)
    hs.settings.set(KEY, clock() / 1e6)
    return originalReload(...)
  end
  _G.HammerspoonStartup = startup
  return startup
end

function M.finish(startup, startedNs)
  startup.initMs = (clock() - startedNs) / 1e6
  -- Retain the one-shot timer: otherwise GC can erase the readiness marker.
  startup.timer = hs.timer.doAfter(0, function()
    startup.timer = nil
    startup.firstEventLoopMs = (clock() - startedNs) / 1e6
    if startup.beforeInitMs then
      startup.totalReloadMs = startup.beforeInitMs + startup.firstEventLoopMs
      print(string.format("Startup: reload %.1f ms; init %.1f ms; first event loop %.1f ms",
        startup.totalReloadMs, startup.initMs, startup.firstEventLoopMs))
    else
      print(string.format("Startup: init %.1f ms; first event loop %.1f ms",
        startup.initMs, startup.firstEventLoopMs))
    end
  end)
end

return M
