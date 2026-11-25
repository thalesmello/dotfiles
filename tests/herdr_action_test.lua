-- Offline HERDR_ACTION_V1 tests: no GUI, IPC, or subprocesses.
local ROOT = "stow_modules/main/dot-hammerspoon/"
local count = 0
local function eq(a, b) assert(a == b, tostring(a) .. " ~= " .. tostring(b)) end
local function test(name, fn) fn(); count = count + 1; print("PASS " .. name) end

-- Minimal RFC 4648 base64 encoder/decoder for offline Lua tests.
local B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local function b64encode(data)
  return ((data:gsub(".", function(x)
    local r, b = "", x:byte()
    for i = 8, 1, -1 do r = r .. (b % 2^i - b % 2^(i - 1) > 0 and "1" or "0") end
    return r
  end) .. "0000"):gsub("%d%d%d?%d?%d?%d?", function(x)
    if #x < 6 then return "" end
    local c = 0
    for i = 1, 6 do c = c + (x:sub(i, i) == "1" and 2^(6 - i) or 0) end
    return B64:sub(c + 1, c + 1)
  end) .. ({ "", "==", "=" })[#data % 3 + 1])
end

local function b64decode(data)
  data = data:gsub("[^" .. B64 .. "=]", "")
  return (data:gsub(".", function(x)
    if x == "=" then return "" end
    local r, f = "", (B64:find(x, 1, true) - 1)
    for i = 6, 1, -1 do r = r .. (f % 2^i - f % 2^(i - 1) > 0 and "1" or "0") end
    return r
  end):gsub("%d%d%d?%d?%d?%d?%d?%d?", function(x)
    if #x ~= 8 then return "" end
    local c = 0
    for i = 1, 8 do c = c + (x:sub(i, i) == "1" and 2^(8 - i) or 0) end
    return string.char(c)
  end))
end

-- Minimal JSON encoder/decoder covering strings, numbers, booleans, arrays, objects.
local function jsonEncode(val)
  local t = type(val)
  if t == "string" then
    return '"' .. val:gsub('\\', '\\\\'):gsub('"', '\\"'):gsub('\n', '\\n'):gsub('\r', '\\r'):gsub('\t', '\\t') .. '"'
  elseif t == "number" or t == "boolean" then
    return tostring(val)
  elseif t == "table" then
    local isArr = (#val > 0)
    if isArr then
      local out = {}
      for i = 1, #val do out[i] = jsonEncode(val[i]) end
      return "[" .. table.concat(out, ",") .. "]"
    else
      local keys = {}
      for k in pairs(val) do keys[#keys + 1] = k end
      table.sort(keys)
      local out = {}
      for _, k in ipairs(keys) do
        out[#out + 1] = jsonEncode(tostring(k)) .. ":" .. jsonEncode(val[k])
      end
      return "{" .. table.concat(out, ",") .. "}"
    end
  end
  return "null"
end

local function jsonDecode(str)
  local pos = 1
  local function skipWs()
    pos = str:match("^%s*()", pos)
  end
  local parseValue
  local function parseString()
    pos = pos + 1
    local out = {}
    while pos <= #str do
      local c = str:sub(pos, pos)
      if c == '"' then pos = pos + 1; return table.concat(out) end
      if c == '\\' then
        pos = pos + 1
        local esc = str:sub(pos, pos)
        if esc == '"' or esc == '\\' or esc == '/' then out[#out + 1] = esc
        elseif esc == 'n' then out[#out + 1] = '\n'
        elseif esc == 'r' then out[#out + 1] = '\r'
        elseif esc == 't' then out[#out + 1] = '\t'
        elseif esc == 'u' then
          local hex = str:sub(pos + 1, pos + 4)
          out[#out + 1] = string.char(tonumber(hex, 16))
          pos = pos + 4
        else error("bad escape") end
      else
        out[#out + 1] = c
      end
      pos = pos + 1
    end
    error("unterminated string")
  end
  local function parseArray()
    pos = pos + 1; skipWs()
    local arr = {}
    if str:sub(pos, pos) == "]" then pos = pos + 1; return arr end
    while true do
      arr[#arr + 1] = parseValue(); skipWs()
      local c = str:sub(pos, pos)
      if c == "]" then pos = pos + 1; return arr end
      assert(c == ",", "expected , in array")
      pos = pos + 1; skipWs()
    end
  end
  local function parseObject()
    pos = pos + 1; skipWs()
    local obj = {}
    if str:sub(pos, pos) == "}" then pos = pos + 1; return obj end
    while true do
      assert(str:sub(pos, pos) == '"', "expected string key")
      local k = parseString(); skipWs()
      assert(str:sub(pos, pos) == ":", "expected :")
      pos = pos + 1; skipWs()
      obj[k] = parseValue(); skipWs()
      local c = str:sub(pos, pos)
      if c == "}" then pos = pos + 1; return obj end
      assert(c == ",", "expected , in object")
      pos = pos + 1; skipWs()
    end
  end
  parseValue = function()
    skipWs()
    local c = str:sub(pos, pos)
    if c == '"' then return parseString()
    elseif c == '[' then return parseArray()
    elseif c == '{' then return parseObject()
    elseif str:sub(pos, pos + 3) == "true" then pos = pos + 4; return true
    elseif str:sub(pos, pos + 4) == "false" then pos = pos + 5; return false
    elseif str:sub(pos, pos + 3) == "null" then pos = pos + 4; return nil
    else
      local num = str:match("^-?%d+%.?%d*", pos)
      assert(num, "unexpected token at " .. pos)
      pos = pos + #num
      return tonumber(num)
    end
  end
  local val = parseValue()
  skipWs()
  assert(pos > #str, "trailing json")
  return val
end

local function fixture(opts)
  opts = opts or {}
  local e = {
    tasks = {},
    notices = {},
    dialogs = {},
    activations = 0,
    prevAppActivations = 0,
    focusCalls = 0,
    dialogChoice = opts.dialogChoice or "Cancel",
    lsOutput = opts.lsOutput or '{"spaces":[]}',
    doOk = opts.doOk ~= false,
  }
  package.loaded.shell = {
    task = function(args, done)
      e.tasks[#e.tasks + 1] = {args = args, done = done}
      if opts.autoRespond ~= false and done then
        if args[1] == "herdr-app" and args[2] == "ls" then
          done(true, e.lsOutput)
        elseif args[1] == "herdr-app" and args[2] == "do" then
          done(e.doOk, "{}")
        end
      end
    end,
  }
  package.loaded.util = {
    log = function() end,
    notify = function(message) e.notices[#e.notices + 1] = message end,
  }
  hs = {
    base64 = {decode = b64decode, encode = b64encode},
    json = {decode = jsonDecode, encode = jsonEncode},
    focus = function() e.focusCalls = e.focusCalls + 1 end,
    dialog = {
      blockAlert = function(title, body, primary, secondary, style)
        e.dialogs[#e.dialogs + 1] = {
          title = title, body = body, primary = primary, secondary = secondary, style = style,
        }
        return e.dialogChoice
      end,
    },
    application = {
      frontmostApplication = function()
        return {activate = function() e.prevAppActivations = e.prevAppActivations + 1 end}
      end,
      get = function(name)
        eq(name, "Herdr")
        if e.absent then return nil end
        return {activate = function(_, all) eq(all, true); e.activations = e.activations + 1 end}
      end,
    },
  }
  e.mod = dofile(ROOT .. "herdrAction.lua")
  return e
end

local function frame(mod, obj)
  return mod.RELAY_PREFIX .. b64encode(jsonEncode(obj)) .. mod.RELAY_SUFFIX
end

test("decode accepts valid attach and local.run payloads", function()
  local e = fixture()
  local req = e.mod.decodeRelayRequest(frame(e.mod, {
    action = "attach", machine = "devserver", terminal = "t5j", mode = "split", direction = "down",
    pane = "devserver/p1", space = "work", name = "logs", focus = false,
  }))
  eq(req.action, "attach"); eq(req.machine, "devserver"); eq(req.terminal, "t5j")
  eq(req.mode, "split"); eq(req.direction, "down"); eq(req.pane, "devserver/p1")
  eq(req.space, "work"); eq(req.name, "logs"); eq(req.focus, false)

  local localReq = e.mod.decodeRelayRequest(frame(e.mod, {
    action = "local.run", argv = {"python3", "-c", "print(1)"}, mode = "tab", folder = "~/src",
  }))
  eq(localReq.action, "local.run"); eq(#localReq.argv, 3); eq(localReq.folder, "~/src")
end)

test("decode rejects malformed framing, injection, bad flags, and unknown actions", function()
  local e = fixture()
  local bad = {
    e.mod.RELAY_PREFIX .. "\31",
    e.mod.RELAY_PREFIX .. "not-b64!\31",
    e.mod.RELAY_PREFIX .. b64encode("not json") .. "\31",
    frame(e.mod, {action = "evil", machine = "devserver", terminal = "t1"}),
    frame(e.mod, {action = "attach", terminal = "t1"}), -- missing machine & core_id
    frame(e.mod, {action = "attach", machine = "--help", terminal = "t1"}),
    frame(e.mod, {action = "attach", machine = "devserver", terminal = "t1;rm -rf /"}),
    frame(e.mod, {action = "attach", machine = "devserver", terminal = "t1", mode = "exec"}),
    frame(e.mod, {action = "attach", machine = "devserver", terminal = "t1", mode = "split", direction = "left"}),
    frame(e.mod, {action = "attach", machine = "devserver", terminal = "t1", pane = "--pane"}),
    frame(e.mod, {action = "attach", machine = "devserver", terminal = "t1", space = "bad\nline"}),
    frame(e.mod, {action = "local.run", argv = {}}),
    frame(e.mod, {action = "local.run", argv = {"bash"}, folder = "/tmp/../etc"}),
    frame(e.mod, {action = "local.run", argv = {"bash"}, folder = "relative/path"}),
  }
  for i, rec in ipairs(bad) do
    assert(e.mod.decodeRelayRequest(rec) == nil, "case " .. i .. " should have been rejected")
  end
end)

test("attach runs with zero confirmation and uses machine/terminal in local space", function()
  local e = fixture({
    lsOutput = '{"spaces":[{"id":"sp1","name":"Local","active":true,"tabs":[]}]}',
  })
  local req = e.mod.decodeRelayRequest(frame(e.mod, {
    action = "attach", machine = "devserver", terminal = "t5j", mode = "tab", name = "dev",
  }))
  e.mod.handle(req)
  eq(#e.dialogs, 0)
  eq(#e.tasks, 2)
  eq(e.tasks[2].args[1], "herdr-app"); eq(e.tasks[2].args[2], "do"); eq(e.tasks[2].args[3], "tab.new")
  local doArgs = jsonDecode(e.tasks[2].args[4])
  eq(doArgs.name, "dev")
  eq(table.concat(doArgs.argv, "|"), "hc|attach|devserver/t5j")
  eq(e.activations, 1)
end)

test("attach omits machine prefix when active space is already on same machine", function()
  local e = fixture({
    lsOutput = '{"spaces":[{"id":"sp2","name":"Dev","machine":"devserver","active":true,"tabs":[]}]}',
  })
  local req = e.mod.decodeRelayRequest(frame(e.mod, {
    action = "attach", machine = "devserver", terminal = "t5j", mode = "split", direction = "right",
  }))
  e.mod.handle(req)
  eq(#e.dialogs, 0)
  eq(e.tasks[2].args[3], "pane.split")
  local doArgs = jsonDecode(e.tasks[2].args[4])
  eq(doArgs.direction, "right")
  eq(table.concat(doArgs.argv, "|"), "hc|attach|t5j")
end)

test("attach with --space reuses first matching workspace", function()
  local e = fixture({
    lsOutput = '{"spaces":[{"id":"spA","name":"work","machine":"devserver","active":false,"tabs":[{"id":"tb1","active":true,"terminals":[{"pane":"devserver/p9"}]}]},{"id":"spB","name":"work","machine":"devserver","active":false,"tabs":[]}]}',
  })
  local req = e.mod.decodeRelayRequest(frame(e.mod, {
    action = "attach", machine = "devserver", terminal = "t7", mode = "split", direction = "down", space = "work",
  }))
  e.mod.handle(req)
  eq(#e.dialogs, 0)
  eq(e.tasks[2].args[3], "pane.split")
  local doArgs = jsonDecode(e.tasks[2].args[4])
  eq(doArgs.pane, "devserver/p9")
  eq(doArgs.direction, "down")
  eq(table.concat(doArgs.argv, "|"), "hc|attach|t7")
end)

test("attach with --space creates new workspace when none matches", function()
  local e = fixture({
    lsOutput = '{"spaces":[{"id":"sp1","name":"other","active":true,"tabs":[]}]}',
  })
  local req = e.mod.decodeRelayRequest(frame(e.mod, {
    action = "attach", machine = "devserver", terminal = "t7", space = "fresh-ws", focus = false,
  }))
  e.mod.handle(req)
  eq(#e.dialogs, 0)
  eq(e.tasks[2].args[3], "space.new")
  local doArgs = jsonDecode(e.tasks[2].args[4])
  eq(doArgs.name, "fresh-ws")
  eq(doArgs.machine, "devserver")
  eq(doArgs.focus, false)
  eq(table.concat(doArgs.argv, "|"), "hc|attach|t7")
  eq(e.activations, 0)
end)

test("local.run cancels without executing when user clicks Cancel", function()
  local e = fixture({dialogChoice = "Cancel"})
  local req = e.mod.decodeRelayRequest(frame(e.mod, {
    action = "local.run", argv = {"python3", "script.py"}, mode = "tab", space = "tools",
  }))
  e.mod.handle(req)
  eq(#e.dialogs, 1)
  assert(e.dialogs[1].body:find("python3 script.py", 1, true) ~= nil)
  assert(e.dialogs[1].body:find("Workspace: tools", 1, true) ~= nil)
  eq(#e.tasks, 0)
  eq(e.prevAppActivations, 1)
end)

test("local.run executes only after confirmation and creates local space with machine=''", function()
  local e = fixture({dialogChoice = "Run", lsOutput = '{"spaces":[]}'})
  local req = e.mod.decodeRelayRequest(frame(e.mod, {
    action = "local.run", argv = {"bash", "-lc", "echo hi"}, mode = "tab", space = "mac-tools", folder = "/tmp",
  }))
  e.mod.handle(req)
  eq(#e.dialogs, 1)
  eq(#e.tasks, 2)
  eq(e.tasks[2].args[3], "space.new")
  local doArgs = jsonDecode(e.tasks[2].args[4])
  eq(doArgs.name, "mac-tools")
  eq(doArgs.machine, "")
  eq(doArgs.folder, "/tmp")
  eq(table.concat(doArgs.argv, "|"), "bash|-lc|echo hi")
  eq(e.activations, 1)
end)

test("local.run split with folder uses terminal.open instead of pane.split", function()
  local e = fixture({dialogChoice = "Run", lsOutput = '{"spaces":[]}'})
  local req = e.mod.decodeRelayRequest(frame(e.mod, {
    action = "local.run", argv = {"ls", "-la"}, mode = "split", direction = "down", folder = "~/src",
  }))
  e.mod.handle(req)
  eq(#e.dialogs, 1)
  eq(e.tasks[2].args[3], "terminal.open")
  local doArgs = jsonDecode(e.tasks[2].args[4])
  eq(doArgs.folder, "~/src")
  eq(doArgs.place, "down")
  eq(table.concat(doArgs.argv, "|"), "ls|-la")
end)

test("herdrRelay restores rich clipboard before dispatching HERDR_ACTION_V1", function()
  local e = fixture({lsOutput = '{"spaces":[]}'})
  e.text = "original clipboard"; e.changeCount = 1; e.restores = 0
  package.loaded.herdrAction = e.mod
  package.loaded.herdrFocus = {RELAY_PREFIX = "\30HERDR_FOCUS_PANE_V1:test:"}
  package.loaded.preset = {}
  package.loaded.ghosttyPreset = {
    readClipboardSnapshot = function() return {rich = "original RTF"} end,
    writeTransientSnapshot = function(snapshot, text)
      eq(snapshot.rich, "original RTF"); eq(text, "original clipboard")
      e.text = text; e.changeCount = e.changeCount + 1; e.restores = e.restores + 1
    end,
    purgeAlfredHerdrEntries = function() end,
    isHerdrCommandClipboard = function() return false end,
  }
  hs.pasteboard = {
    readString = function() return e.text end,
    changeCount = function() return e.changeCount end,
    watcher = {
      interval = function() end,
      new = function(callback) e.changed = callback; return {stop = function() end} end,
    },
  }
  dofile(ROOT .. "herdrRelay.lua").setup()
  local rec = frame(e.mod, {action = "attach", machine = "devserver", terminal = "t5j"})
  e.text = rec; e.changeCount = e.changeCount + 1; e.changed(rec)
  eq(e.text, "original clipboard"); eq(e.restores, 1)
  eq(#e.tasks, 2); eq(e.tasks[2].args[3], "tab.new")
end)

print(count .. " Herdr action tests passed")
