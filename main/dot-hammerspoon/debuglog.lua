local M = {}

function M.setup()
  local DEBUG = false
  if not DEBUG then return end

  local logPath = "/tmp/hammerspoon.log"
  local logFile = io.open(logPath, "a")

  if logFile then
    logFile:setvbuf("line")
    local oldPrint = print
    print = function(...)
      logFile:write(table.concat({...}, "\t") .. "\n")
      logFile:flush()
      oldPrint(...)
    end
  end
end

return M
