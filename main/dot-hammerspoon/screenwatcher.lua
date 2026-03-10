local util = require("util")
local FISH = "/opt/homebrew/bin/fish"

local previousScreenCount = #hs.screen.allScreens()

local function screenCallback()
  local currentScreenCount = #hs.screen.allScreens()
  util.log("screenwatcher: screens changed, previous=", previousScreenCount, "current=", currentScreenCount)

  if currentScreenCount == 1 and previousScreenCount > 1 then
    util.log("screenwatcher: single monitor detected, moving workspace 9 → 1")
    hs.task.new(FISH, function(exitCode, stdOut, stdErr)
      util.log("screenwatcher: exitCode=", exitCode)
      if stdOut and #stdOut > 0 then util.log("screenwatcher stdout:", stdOut) end
      if stdErr and #stdErr > 0 then util.log("screenwatcher stderr:", stdErr) end
    end, {"-c", "aerospace-preset move-all-windows-in-workspace --from 9 --to 1"}):start()
  end

  previousScreenCount = currentScreenCount
end

hs.screen.watcher.new(screenCallback):start()
