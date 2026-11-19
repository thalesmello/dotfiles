-- Clickable local focus links, including links printed by remote agents:
--   hammerspoon://herdr-focus?pane=<percent-encoded pane ID from herdr-app ls>
-- The click runs on the Mac, not in the terminal that printed the link.
local shell = require("shell")
local util = require("util")
local M = {}

function M.handle(_eventName, params, _senderPID, fullURL)
  local pane = params and params.pane
  -- Some URL event deliveries leave query values encoded. Decode only if
  -- byte-identical to the raw query, never twice (same rule as workflowPreset).
  local raw = fullURL and fullURL:match("[?&]pane=([^&#]*)")
  if type(pane) == "string" and raw == pane and pane:find("%%%x%x") then
    pane = pane:gsub("%%(%x%x)", function(hex)
      return string.char(tonumber(hex, 16))
    end)
  end
  -- Never allow an omitted target to focus the current pane. Accept qualified
  -- remote IDs (machine/pane) but reject controls, whitespace and option flags.
  if type(pane) ~= "string" or #pane > 512
      or not pane:match("^[%w][%w_.:/-]*$") then
    util.notify("Herdr focus: missing or invalid pane ID")
    return
  end

  -- Direct argv, not shell interpolation; a URL can only request pane.focus.
  shell.task({"herdr-app", "do", "pane.focus", "--pane", pane}, function(ok, out)
    if not ok then
      util.log("herdrFocus: focus failed", pane, out)
      util.notify("Could not focus Herdr pane: " .. pane)
      return
    end
    -- The CLI changes the selected pane; also bring the existing window forward
    -- when the link was opened from another application. Never launch a new one.
    local app = hs.application.get("Herdr")
    if app then app:activate(true) end
  end)
end

function M.setup()
  hs.urlevent.bind("herdr-focus", M.handle)
end

return M
