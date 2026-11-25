-- Remote actions relayed from a Herdr pane via OSC 52 to herdr-app on this Mac.
--
-- Wire format (must match bin/herdr-remote):
--   \30HERDR_ACTION_V1:4d8e9a1c6f3b4e2da91f7c508b2e641a:<base64(json)>\31
--
-- Security model:
--   1. Zero confirmation for attaching a new tab / split / workspace to an
--      existing remote hc terminal (strict regex validation on machine &
--      terminal IDs; direct argv to herdr-app do ...; zero shell interpolation).
--   2. Mandatory confirmation dialog BEFORE running any local command on this
--      Mac (local.run), showing the exact command and target, with no
--      "always allow" bypass.
local shell = require("shell")
local util = require("util")
local M = {}

M.RELAY_PREFIX = "\30HERDR_ACTION_V1:4d8e9a1c6f3b4e2da91f7c508b2e641a:"
M.RELAY_SUFFIX = "\31"

local MAX_ENCODED_LEN = 16384
local MAX_ARGV_LEN = 64
local MAX_ARG_BYTES = 2048

local function validToken(value, maxLen)
  return type(value) == "string"
      and #value >= 1
      and #value <= (maxLen or 128)
      and value:match("^[A-Za-z0-9][A-Za-z0-9._-]*$") ~= nil
end

local function validPane(pane)
  return type(pane) == "string"
      and #pane >= 1
      and #pane <= 512
      and pane:match("^[%w][%w_.:/-]*$") ~= nil
end

local function validLabel(value, maxLen)
  return type(value) == "string"
      and #value >= 1
      and #value <= (maxLen or 128)
      and not value:find("[%z\1-\31\127]")
end

local function validFolder(folder)
  if type(folder) ~= "string" or #folder == 0 or #folder > 512 then return false end
  if folder:find("[%z\1-\31\127]") or folder:find("%.%.") then return false end
  if folder == "~" then return true end
  return folder:match("^/") ~= nil or folder:match("^~/") ~= nil
end

local function validCoreId(value)
  return type(value) == "string"
      and #value >= 1
      and #value <= 64
      and value:match("^[0-9a-fA-F]+$") ~= nil
end

local function validArgv(argv)
  if type(argv) ~= "table" or #argv < 1 or #argv > MAX_ARGV_LEN then return false end
  for i = 1, #argv do
    local item = argv[i]
    if type(item) ~= "string" or #item > MAX_ARG_BYTES or item:find("%z") then
      return false
    end
  end
  -- Reject non-array keys so hs.json.encode always produces a JSON array.
  for k in pairs(argv) do
    if type(k) ~= "number" or k < 1 or k > #argv or math.floor(k) ~= k then
      return false
    end
  end
  return true
end

local function validateCommonLayout(raw, out)
  local mode = raw.mode or "tab"
  if mode ~= "tab" and mode ~= "split" then return nil end
  out.mode = mode

  if mode == "split" then
    local direction = raw.direction or "right"
    if direction ~= "right" and direction ~= "down" then return nil end
    out.direction = direction
  elseif raw.direction ~= nil then
    return nil
  end

  if raw.pane ~= nil then
    if not validPane(raw.pane) then return nil end
    out.pane = raw.pane
  end

  if raw.space ~= nil then
    if not validLabel(raw.space, 128) then return nil end
    out.space = raw.space
  end

  if raw.name ~= nil then
    if not validLabel(raw.name, 128) then return nil end
    out.name = raw.name
  end

  if raw.focus ~= nil then
    if type(raw.focus) ~= "boolean" then return nil end
    out.focus = raw.focus
  else
    out.focus = true
  end

  return out
end

function M.decodeRelayRequest(contents)
  if type(contents) ~= "string" then return nil end
  if contents:sub(1, #M.RELAY_PREFIX) ~= M.RELAY_PREFIX then return nil end
  if contents:sub(-#M.RELAY_SUFFIX) ~= M.RELAY_SUFFIX then return nil end

  local encoded = contents:sub(#M.RELAY_PREFIX + 1, -#M.RELAY_SUFFIX - 1)
  if #encoded == 0 or #encoded > MAX_ENCODED_LEN then return nil end
  if not encoded:match("^[A-Za-z0-9+/]*=?=?$") then return nil end

  local okDecode, rawJson = pcall(hs.base64.decode, encoded)
  if not okDecode or type(rawJson) ~= "string" or #rawJson == 0 then return nil end

  local okJson, raw = pcall(hs.json.decode, rawJson)
  if not okJson or type(raw) ~= "table" then return nil end

  local action = raw.action
  if action == "attach" then
    if not validToken(raw.terminal, 128) then return nil end
    if raw.machine ~= nil and not validToken(raw.machine, 128) then return nil end
    if raw.core_id ~= nil and not validCoreId(raw.core_id) then return nil end
    if raw.machine == nil and raw.core_id == nil then return nil end

    local req = {
      action = "attach",
      terminal = raw.terminal,
      machine = raw.machine,
      core_id = raw.core_id and raw.core_id:lower() or nil,
    }
    return validateCommonLayout(raw, req)
  elseif action == "local.run" then
    if not validArgv(raw.argv) then return nil end
    if raw.folder ~= nil and not validFolder(raw.folder) then return nil end

    local req = {
      action = "local.run",
      argv = raw.argv,
      folder = raw.folder,
    }
    return validateCommonLayout(raw, req)
  end

  return nil
end

-- Resolve a remote machine alias from ~/.local/state/herdr-core/default/machines.json
-- using the sender's herdr-core hex ID, matching herdrRelay.lua's paste lookup.
function M.resolveMachineName(coreId, machinesPath)
  local path = machinesPath
  if not path then
    local stateHome = os.getenv("XDG_STATE_HOME")
      or ((os.getenv("HOME") or "") .. "/.local/state")
    path = stateHome .. "/herdr-core/default/machines.json"
  end
  local file = io.open(path, "r")
  if not file then return nil end
  local raw = file:read("*a")
  file:close()
  if not raw or raw == "" then return nil end

  local ok, machines = pcall(hs.json.decode, raw)
  if not ok or type(machines) ~= "table" then return nil end

  if validCoreId(coreId) then
    local want = coreId:lower()
    for _, entry in ipairs(machines) do
      if type(entry) == "table"
          and type(entry.id) == "string"
          and entry.id:lower() == want
          and validToken(entry.name, 128) then
        return entry.name
      end
    end
  end

  if #machines == 1 then
    local only = machines[1]
    if type(only) == "table" and validToken(only.name, 128) then
      return only.name
    end
  end

  return nil
end

local function isLocalSpace(sp)
  return type(sp) == "table" and (sp.machine == nil or sp.machine == "")
end

local function findSpace(spaces, want, localOnly)
  if type(spaces) ~= "table" or type(want) ~= "string" then return nil end
  -- First pass: exact ID match; second pass: first matching name.
  for _, sp in ipairs(spaces) do
    if type(sp) == "table" and sp.id == want and (not localOnly or isLocalSpace(sp)) then
      return sp
    end
  end
  for _, sp in ipairs(spaces) do
    if type(sp) == "table" and sp.name == want and (not localOnly or isLocalSpace(sp)) then
      return sp
    end
  end
  return nil
end

local function findActiveSpace(spaces)
  if type(spaces) ~= "table" then return nil end
  for _, sp in ipairs(spaces) do
    if type(sp) == "table" and sp.active then return sp end
  end
  return nil
end

local function firstPaneInSpace(sp)
  if type(sp) ~= "table" or type(sp.tabs) ~= "table" then return nil end
  -- Prefer the active tab's first pane, then any tab's first pane.
  for _, tab in ipairs(sp.tabs) do
    if type(tab) == "table" and tab.active and type(tab.terminals) == "table" then
      for _, term in ipairs(tab.terminals) do
        if type(term) == "table" and validPane(term.pane) then return term.pane end
      end
    end
  end
  for _, tab in ipairs(sp.tabs) do
    if type(tab) == "table" and type(tab.terminals) == "table" then
      for _, term in ipairs(tab.terminals) do
        if type(term) == "table" and validPane(term.pane) then return term.pane end
      end
    end
  end
  return nil
end

local function formatArg(arg)
  if arg == "" or arg:find("[%s'\"\\$\96!;|&<>()*?%[%]{}]") then
    return "'" .. arg:gsub("'", "'\\''") .. "'"
  end
  return arg
end

local function formatArgv(argv)
  local parts = {}
  for i = 1, #argv do
    parts[i] = formatArg(argv[i])
  end
  return table.concat(parts, " ")
end

local function formatLocalTarget(req)
  local lines = {}
  if req.mode == "split" then
    lines[#lines + 1] = "Action: Split pane (" .. req.direction .. ")"
  else
    lines[#lines + 1] = "Action: New tab"
  end
  if req.space then
    lines[#lines + 1] = "Workspace: " .. req.space .. " (reuse first match or create)"
  end
  if req.pane then
    lines[#lines + 1] = "Anchor pane: " .. req.pane
  end
  if req.name then
    lines[#lines + 1] = "Tab name: " .. req.name
  end
  if req.folder then
    lines[#lines + 1] = "Folder: " .. req.folder
  end
  lines[#lines + 1] = ""
  lines[#lines + 1] = "Command:"
  lines[#lines + 1] = formatArgv(req.argv)
  return table.concat(lines, "\n")
end

local function runHerdrAppDo(command, doArgs, shouldFocus, errorPrefix)
  local encodedArgs = hs.json.encode(doArgs)
  shell.task({"herdr-app", "do", command, encodedArgs}, function(ok, out)
    if not ok then
      util.log("herdrAction:", command, "failed:", out)
      util.notify(errorPrefix .. ": " .. command .. " failed")
      return
    end
    if shouldFocus then
      local app = hs.application.get("Herdr")
      if app then app:activate(true) end
    end
  end)
end

local function querySpaces(callback)
  shell.task({"herdr-app", "ls", print_stdout = false}, function(ok, out)
    if not ok or type(out) ~= "string" or out == "" then
      callback(nil)
      return
    end
    local okJson, parsed = pcall(hs.json.decode, out)
    if okJson and type(parsed) == "table" and type(parsed.spaces) == "table" then
      callback(parsed.spaces)
    else
      callback(nil)
    end
  end)
end

local function buildAttachArgv(machine, terminal, targetSpace)
  if type(targetSpace) == "table" and targetSpace.machine == machine then
    return {"hc", "attach", terminal}
  end
  return {"hc", "attach", machine .. "/" .. terminal}
end

local function executeAttach(req)
  local machine = req.machine or M.resolveMachineName(req.core_id)
  if not validToken(machine, 128) then
    util.log("herdrAction: could not resolve machine for core_id", tostring(req.core_id))
    util.notify("Herdr attach: could not resolve remote machine")
    return
  end

  local shouldFocus = req.focus ~= false
  local errPrefix = "Herdr attach (" .. machine .. "/" .. req.terminal .. ")"

  querySpaces(function(spaces)
    if req.space then
      local matched = findSpace(spaces, req.space, false)
      if not matched then
        local doArgs = {
          name = req.space,
          machine = machine,
          argv = {"hc", "attach", req.terminal},
        }
        if not shouldFocus then doArgs.focus = false end
        runHerdrAppDo("space.new", doArgs, shouldFocus, errPrefix)
        return
      end

      local attachArgv = buildAttachArgv(machine, req.terminal, matched)
      if req.mode == "split" then
        local anchor = req.pane or firstPaneInSpace(matched)
        if anchor then
          runHerdrAppDo("pane.split", {
            direction = req.direction,
            pane = anchor,
            argv = attachArgv,
          }, shouldFocus, errPrefix)
          return
        end
      end

      local doArgs = {
        space = matched.id,
        argv = attachArgv,
      }
      if req.name then doArgs.name = req.name end
      if not shouldFocus then doArgs.focus = false end
      runHerdrAppDo("tab.new", doArgs, shouldFocus, errPrefix)
      return
    end

    local activeSpace = findActiveSpace(spaces)
    local attachArgv = buildAttachArgv(machine, req.terminal, activeSpace)
    if req.mode == "split" then
      local doArgs = {
        direction = req.direction,
        argv = attachArgv,
      }
      if req.pane then doArgs.pane = req.pane end
      runHerdrAppDo("pane.split", doArgs, shouldFocus, errPrefix)
      return
    end

    local doArgs = {
      argv = attachArgv,
    }
    if req.name then doArgs.name = req.name end
    if not shouldFocus then doArgs.focus = false end
    runHerdrAppDo("tab.new", doArgs, shouldFocus, errPrefix)
  end)
end

local function executeLocalRun(req)
  local previousApp = hs.application.frontmostApplication()

  -- Mandatory confirmation before running any local command on this Mac.
  hs.focus()
  local button = hs.dialog.blockAlert(
    "Run local command in Herdr?",
    formatLocalTarget(req),
    "Run",
    "Cancel",
    "warning"
  )
  if button ~= "Run" then
    if previousApp then previousApp:activate(true) end
    return
  end

  local shouldFocus = req.focus ~= false
  local errPrefix = "Herdr local run"

  querySpaces(function(spaces)
    if req.space then
      local matched = findSpace(spaces, req.space, true)
      if not matched then
        local doArgs = {
          name = req.space,
          machine = "",
          argv = req.argv,
        }
        if req.folder then doArgs.folder = req.folder end
        if not shouldFocus then doArgs.focus = false end
        runHerdrAppDo("space.new", doArgs, shouldFocus, errPrefix)
        return
      end

      if req.mode == "split" then
        local anchor = req.pane or firstPaneInSpace(matched)
        if anchor then
          runHerdrAppDo("pane.split", {
            direction = req.direction,
            pane = anchor,
            argv = req.argv,
          }, shouldFocus, errPrefix)
          return
        end
      end

      local doArgs = {
        space = matched.id,
        argv = req.argv,
      }
      if req.name then doArgs.name = req.name end
      if req.folder then doArgs.folder = req.folder end
      if not shouldFocus then doArgs.focus = false end
      runHerdrAppDo("tab.new", doArgs, shouldFocus, errPrefix)
      return
    end

    if req.mode == "split" then
      if req.folder and not req.pane then
        runHerdrAppDo("terminal.open", {
          folder = req.folder,
          place = req.direction,
          argv = req.argv,
        }, shouldFocus, errPrefix)
        return
      end
      local doArgs = {
        direction = req.direction,
        argv = req.argv,
      }
      if req.pane then doArgs.pane = req.pane end
      runHerdrAppDo("pane.split", doArgs, shouldFocus, errPrefix)
      return
    end

    local doArgs = {
      argv = req.argv,
    }
    if req.name then doArgs.name = req.name end
    if req.folder then doArgs.folder = req.folder end
    if not shouldFocus then doArgs.focus = false end
    runHerdrAppDo("tab.new", doArgs, shouldFocus, errPrefix)
  end)
end

function M.handle(req)
  if type(req) ~= "table" then return end
  if req.action == "attach" then
    executeAttach(req)
  elseif req.action == "local.run" then
    executeLocalRun(req)
  else
    util.log("herdrAction: ignoring unknown action", tostring(req.action))
  end
end

return M
