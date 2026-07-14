local shell = require("shell")
local util = require("util")

local M = {}

-- While Mission Control is on screen, a right click closes the window whose
-- tile sits under the cursor. Both the detection (osascript-preset) and the
-- close (yabai) run as async tasks, so the eventtap callback never blocks the
-- system's right-click path; we let the event pass through and act on the side.
function M.setup()
  local tap
  tap = hs.eventtap.new({hs.eventtap.event.types.rightMouseUp}, function()
    shell.task({"osascript-preset", "is-mission-control-active"}, function(_, active)
      if active == "true" then
        util.log("missioncontrol: right click, closing window under cursor")
        shell.task({"yabai", "-m", "window", "mouse", "--close"})
      end
    end)
    -- Never swallow the click: outside Mission Control it must still reach apps.
    return false
  end)

  tap:start()
  _G.MissionControlRightClick = tap
end

return M
