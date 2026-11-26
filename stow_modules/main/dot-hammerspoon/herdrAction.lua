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
  elseif action == "pane.move" then
    if not validPane(raw.pane) or not validPane(raw.space) then return nil end
    if raw.tab ~= nil and not validPane(raw.tab) then return nil end
    if raw.name ~= nil and not validLabel(raw.name, 128) then return nil end
    return {action = action, pane = raw.pane, space = raw.space, tab = raw.tab, name = raw.name}
  elseif action == "list" then
    if raw.kind ~= "agents" and raw.kind ~= "workspaces" and raw.kind ~= "tabs" then return nil end
    local reply = raw.reply
    if type(reply) ~= "table" or not validCoreId(reply.core_id)
        or type(reply.nonce) ~= "string" or #reply.nonce ~= 32
        or not reply.nonce:match("^[0-9a-f]+$") then return nil end
    for _, path in ipairs({reply.socket or false, reply.bin or false}) do
      if type(path) ~= "string" or #path > 512
          or not path:match("^/[A-Za-z0-9._/-]+$") or path:find("%.%.") then return nil end
    end
    if not reply.socket:match("/herdr%-remote%-[A-Za-z0-9_-]+/reply%.sock$")
        or not reply.bin:match("/herdr%-remote$") then return nil end
    return {action = action, kind = raw.kind, reply = reply}
  elseif action == "focus" or action == "space.select"
      or action == "tab.select" or action == "pane.zoom" then
    if not validPane(raw.target) then return nil end
    return {action = action, target = raw.target}
  elseif action == "local.run" then
    if not validLabel(raw.space, 128) then return nil end
    if raw.mode == "split" and (raw.folder ~= nil or raw.focus == false) then return nil end
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

local function runHerdrAppDo(command, doArgs, shouldFocus, errorPrefix, done)
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
    if done then done(out) end
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
    if not spaces then
      util.notify("Herdr attach: could not inspect workspaces")
      return
    end
    if req.space then
      local matched = findSpace(spaces, req.space, false)
      if not matched then
        if req.pane then util.notify("Herdr attach: anchor workspace not found"); return end
        local doArgs = {
          name = req.space,
          tab = req.name or (machine .. "/" .. req.terminal),
          machine = machine,
          argv = {"hc", "attach", req.terminal},
        }
        if not shouldFocus then doArgs.focus = false end
        runHerdrAppDo("space.new", doArgs, shouldFocus, errPrefix)
        return
      end

      if req.pane then
        local found = false
        for _, tab in ipairs(matched.tabs or {}) do
          for _, term in ipairs(tab.terminals or {}) do
            if term.pane == req.pane then found = true end
          end
        end
        if not found then util.notify("Herdr attach: anchor is outside requested workspace"); return end
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
  -- Resolve the actual machine and anchor before asking permission.
  querySpaces(function(spaces)
    if not spaces then
      util.notify("Herdr local run: could not inspect workspaces")
      return
    end
    local matched = findSpace(spaces, req.space, false)
    if matched and not isLocalSpace(matched) then
      util.notify("Herdr local run: requested workspace is remote")
      return
    end
    local anchor = matched and firstPaneInSpace(matched)
    if req.pane then
      local found = false
      for _, tab in ipairs(matched and matched.tabs or {}) do
        for _, term in ipairs(tab.terminals or {}) do
          if term.pane == req.pane then found = true end
        end
      end
      if not found then
        util.notify("Herdr local run: anchor is outside the requested workspace")
        return
      end
      anchor = req.pane
    end
    local previousApp = hs.application.frontmostApplication()
    hs.focus()
    local button = hs.dialog.blockAlert(
      "Run local command in Herdr?",
      "Machine: this Mac\n" .. formatLocalTarget(req)
        .. (matched and ("\nWorkspace ID: " .. matched.id) or "\nCreate local workspace"),
      "Run", "Cancel", "warning"
    )
    if previousApp then previousApp:activate(true) end
    if button ~= "Run" then return end

    local args = {argv = req.argv, name = req.name or req.argv[1]}
    local command = "tab.new"
    if not matched then
      command = "space.new"
      args.name = req.space
      args.tab = req.name or req.argv[1]
      args.machine = ""
    elseif req.mode == "split" and anchor then
      command = "pane.split"
      args.name = nil
      args.pane = anchor
      args.direction = req.direction
    else
      args.space = matched.id
    end
    if req.folder then args.folder = req.folder end
    if req.focus == false then args.focus = false end
    runHerdrAppDo(command, args, req.focus ~= false, "Herdr local run")
  end)
end

local function executeNavigation(req)
  querySpaces(function(spaces)
    if not spaces then
      util.notify("Herdr action: could not inspect workspaces")
      return
    end
    local command, args, targetSpace
    for _, sp in ipairs(spaces) do
      if req.action == "space.select" and sp.id == req.target then
        command, args = "space.select", {id = sp.id}
      end
      for _, tab in ipairs(sp.tabs or {}) do
        if req.action == "tab.select" and tab.id == req.target then
          command, args, targetSpace = "tab.select", {id = tab.id}, sp.id
        end
        for _, term in ipairs(tab.terminals or {}) do
          if req.action == "focus" and term.terminal == req.target then
            command, args = "agent.focus", {terminal = term.terminal}
          elseif req.action == "pane.zoom" and term.pane == req.target then
            command, args = "pane.zoom", {pane = term.pane}
          end
        end
      end
    end
    if not command and req.action == "focus" then
      -- Hidden terminals have no entry in app ls. Validate against the core.
      shell.task({"hc", "get", req.target, "--json", print_stdout = false}, function(ok, out)
        local parsedOk, term = pcall(hs.json.decode, out or "")
        if not ok or not parsedOk or type(term) ~= "table"
            or term.address ~= req.target or term.state ~= "live" then
          util.notify("Herdr focus: terminal not found: " .. req.target)
          return
        end
        runHerdrAppDo("agent.focus", {terminal = req.target}, true, "Herdr focus")
      end)
      return
    end
    if not command then
      util.notify("Herdr action: target not found: " .. req.target)
      return
    end
    if targetSpace then
      runHerdrAppDo("space.select", {id = targetSpace}, false, "Herdr action", function()
        runHerdrAppDo(command, args, true, "Herdr action")
      end)
    else
      runHerdrAppDo(command, args, true, "Herdr action")
    end
  end)
end

local function executeMove(req)
  querySpaces(function(spaces)
    if not spaces then util.notify("Herdr move: could not inspect workspaces"); return end
    local source, destination, terminal
    for _, sp in ipairs(spaces) do
      if sp.id == req.space then destination = sp end
      for _, tab in ipairs(sp.tabs or {}) do
        for _, term in ipairs(tab.terminals or {}) do
          if term.pane == req.pane then source, terminal = sp, term.terminal end
        end
      end
    end
    if not source or not destination or not validPane(terminal) then
      util.notify("Herdr move: source or destination not found"); return
    end
    if (source.machine or "") ~= (destination.machine or "") then
      util.notify("Herdr move: cross-machine moves are unsupported"); return
    end
    if req.tab then
      local found = false
      for _, tab in ipairs(destination.tabs or {}) do
        if tab.id == req.tab then found = true end
      end
      if not found then util.notify("Herdr move: destination tab not found"); return end
    end
    local helper = shell.resolvePath("herdr-remote")
    if not helper then util.notify("Herdr move: local helper not installed"); return end
    local argv = {helper, "--move-on-mac", req.pane, req.space, req.tab or "-",
      req.name or "moved pane", terminal}
    local previousApp = hs.application.frontmostApplication()
    hs.focus()
    local button = hs.dialog.blockAlert("Move Herdr pane?",
      "Run local helper on this Mac\nSource: " .. req.pane .. " (" .. terminal .. ")"
        .. "\nDestination workspace: " .. req.space .. "\nDestination tab: " .. (req.tab or "new tab")
        .. "\n\nCommand:\n" .. formatArgv(argv), "Move", "Cancel", "warning")
    if previousApp then previousApp:activate(true) end
    if button ~= "Move" then return end
    shell.task(argv, function(ok, out)
      if not ok then
        util.log("Herdr move failed:", out)
        util.notify("Herdr move failed; inspect layout before retrying")
      end
    end)
  end)
end

local function deliverListing(reply, result)
  local machine = M.resolveMachineName(reply.core_id)
  if not machine then
    util.notify("Herdr list: requester machine not found")
    return
  end
  local encoded = hs.json.encode(result)
  if #encoded > 1048576 then encoded = hs.json.encode({error = "listing exceeds byte limit"}) end
  -- Infrastructure-only route: fixed hc exec argv, data on stdin, no local shell.
  shell.whenReady(function(ok)
    if not ok then util.notify("Herdr list: PATH discovery failed"); return end
    local hc = shell.resolvePath("hc")
    if not hc then util.notify("Herdr list: hc not found"); return end
    _G._RunningTasks = _G._RunningTasks or {}
    local task
    task = hs.task.new(hc, function(code, _, err)
      _G._RunningTasks[task] = nil
      if code ~= 0 then util.log("Herdr list delivery failed:", err); util.notify("Herdr list delivery failed") end
    end, {"exec", "-i", "--on", machine, "--", reply.bin,
      "--deliver-reply", reply.socket, reply.nonce})
    if not task then util.notify("Herdr list: could not create task"); return end
    if _G._TaskEnv then task:setEnvironment(_G._TaskEnv) end
    task:setInput(encoded)
    _G._RunningTasks[task] = true
    if not task:start() then
      _G._RunningTasks[task] = nil
      util.notify("Herdr list: could not start delivery")
    end
  end)
end

local function executeListing(req)
  if req.kind == "agents" then
    shell.task({"hc", "ls", "--json", print_stdout = false}, function(ok, out)
      local parsedOk, parsed = pcall(hs.json.decode, out or "")
      if not ok or not parsedOk or type(parsed) ~= "table" or type(parsed.terminals) ~= "table" then
        deliverListing(req.reply, {error = "could not inspect coding sessions"})
        return
      end
      local entries = {}
      for _, term in ipairs(parsed.terminals) do
        if term.agent and term.agent ~= "fish" and term.agent ~= "sh"
            and term.agent ~= "bash" and term.agent ~= "zsh" then
          entries[#entries + 1] = {terminal = term.address, name = term.name,
            app = term.agent, status = term.status, state = term.state, cwd = term.cwd}
        end
      end
      deliverListing(req.reply, {agents = entries})
    end)
    return
  end
  querySpaces(function(spaces)
    if not spaces then deliverListing(req.reply, {error = "could not inspect workspaces"}); return end
    local entries = {}
    for _, sp in ipairs(spaces) do
      if req.kind == "workspaces" then
        entries[#entries + 1] = {id = sp.id, name = sp.name, machine = sp.machine,
          folder = sp.folder, active = sp.active}
      else
        for _, tab in ipairs(sp.tabs or {}) do
          entries[#entries + 1] = {id = tab.id, name = tab.name, space = sp.id,
            machine = sp.machine, active = tab.active, terminals = tab.terminals}
        end
      end
    end
    deliverListing(req.reply, {[req.kind] = entries})
  end)
end

function M.handle(req)
  if type(req) ~= "table" then return end
  if req.action == "pane.move" then
    executeMove(req)
  elseif req.action == "list" then
    executeListing(req)
  elseif req.action == "attach" then
    executeAttach(req)
  elseif req.action == "local.run" then
    executeLocalRun(req)
  elseif req.action == "focus" or req.action == "space.select"
      or req.action == "tab.select" or req.action == "pane.zoom" then
    executeNavigation(req)
  else
    util.log("herdrAction: ignoring unknown action", tostring(req.action))
  end
end

return M
