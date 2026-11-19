-- Clickable local focus links, including links printed by remote agents:
--   hammerspoon://herdr-focus?pane=<percent-encoded pane ID from herdr-app ls>
-- The click runs on the Mac, not in the terminal that printed the link.
local shell = require("shell")
local util = require("util")
local M = {}

-- Dedicated, focus-only OSC 52 relay. Must match Pi extensions/osc8-links.ts.
M.RELAY_PREFIX = "\30HERDR_FOCUS_PANE_V1:704f9b1e57a240cdae891e4072b64d38:"

local function validPane(pane)
  return type(pane) == "string" and #pane <= 512
      and pane:match("^[%w][%w_.:/-]*$") ~= nil
end

function M.decodeRelayRequest(contents)
  if type(contents) ~= "string" or contents:sub(1, #M.RELAY_PREFIX) ~= M.RELAY_PREFIX
      or contents:sub(-1) ~= "\31" then return nil end
  local encoded = contents:sub(#M.RELAY_PREFIX + 1, -2)
  if #encoded == 0 or #encoded > 684 or not encoded:match("^[A-Za-z0-9+/]*=?=?$") then return nil end
  local ok, pane = pcall(hs.base64.decode, encoded)
  if ok and validPane(pane) then return pane end
end

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
  M.focus(pane)
end

function M.focus(pane)
  if not validPane(pane) then
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
