-- Handler for the hammerspoon:// URLs that rxpick renders.
--
-- `workflow-preset pick-selections --url-format` (see the herdr prefix+o/prefix+y
-- bindings) turns every picked match into
--
--     hammerspoon://workflow-preset/open-selection?type=<type>&match=<match>
--
-- and either opens it directly or wraps the printed match in an OSC 8 hyperlink
-- so the pick is clickable. Routing through a URL rather than running
-- workflow-preset in the pane is what makes this work over `herdr --remote`:
-- the click is handled by the terminal on the LOCAL Mac, so the action runs
-- here, next to nvim/Chrome, not on the remote herdr server.
--
-- hs.urlevent treats the URL's host as the event name and officially wants no
-- path, so the whole scheme is bound to one event ("workflow-preset") and the
-- action is taken from the path of the full URL. That keeps room for more
-- actions later without another urlevent binding.

local shell = require("shell")
local util = require("util")

local M = {}

local WORKFLOW_PRESET = os.getenv("HOME") .. "/.local_dotfiles/bin/workflow-preset"

-- Hammerspoon hands back percent-decoded query values, but a decoded value is
-- indistinguishable from one that was never decoded when the match happens to
-- contain no escapes. Only decode when the value came through byte-identical to
-- the raw query string AND still looks encoded, so a match with a literal '%'
-- in it is never decoded twice.
local function decoded(value, key, fullURL)
  if not value or not fullURL then return value end
  local raw = fullURL:match("[?&]" .. key .. "=([^&#]*)")
  if raw ~= value or not value:find("%%%x%x") then return value end
  return (value:gsub("%%(%x%x)", function(hex)
    return string.char(tonumber(hex, 16))
  end):gsub("+", " "))
end

-- action name (URL path) -> handler(match, type)
M.actions = {
  ["open-selection"] = function(match)
    shell.task({ WORKFLOW_PRESET, "open-selection", match }, function(ok)
      if not ok then util.notify("Could not open: " .. match) end
    end)
  end,
}

function M.handle(eventName, params, senderPid, fullURL)
  params = params or {}
  local action = fullURL and fullURL:match("^%a[%w+.-]*://[^/?#]*/([^?#]+)") or nil
  action = action or "open-selection"

  local handler = M.actions[action]
  if not handler then
    util.log("workflowPreset: unknown action", action, fullURL)
    util.notify("workflow-preset: unknown action " .. action)
    return
  end

  local match = decoded(params.match, "match", fullURL)
  if not match or match == "" then
    util.log("workflowPreset: no match in", fullURL)
    return
  end

  util.log("workflowPreset:", action, params.type, match)
  handler(match, decoded(params.type, "type", fullURL))
end

function M.setup()
  hs.urlevent.bind("workflow-preset", M.handle)
end

return M
