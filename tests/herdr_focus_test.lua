-- Offline URL-handler tests: no GUI, IPC, or subprocesses.
local ROOT = "stow_modules/main/dot-hammerspoon/"
local count = 0
local function eq(a, b) assert(a == b, tostring(a) .. " ~= " .. tostring(b)) end
local function test(name, fn) fn(); count = count + 1; print("PASS " .. name) end
local function fixture()
  local e = {tasks = {}, notices = {}, activations = 0}
  package.loaded.shell = {task = function(args, done)
    e.tasks[#e.tasks + 1] = {args = args, done = done}
  end}
  package.loaded.util = {log = function() end, notify = function(message)
    e.notices[#e.notices + 1] = message
  end}
  hs = {
    base64 = {decode = function(value)
      local decoded = {cDEy = "p12", ["ZGV2c2VydmVyL3AxMg=="] = "devserver/p12",
        ["LS1oZWxw"] = "--help", ["cDEyCg=="] = "p12\n",
        ["aHR0cHM6Ly9leGFtcGxlLmNvbQ=="] = "https://example.com"}
      if not decoded[value] then error("invalid base64") end
      return decoded[value]
    end},
    urlevent = {bind = function(name, handler) e.event = name; e.handler = handler end},
    application = {get = function(name)
      eq(name, "Herdr")
      if e.absent then return nil end
      return {activate = function(_, all) eq(all, true); e.activations = e.activations + 1 end}
    end},
  }
  e.mod = dofile(ROOT .. "herdrFocus.lua")
  e.mod.setup()
  return e
end

test("setup binds event without starting work", function()
  local e = fixture(); eq(e.event, "herdr-focus"); eq(e.handler, e.mod.handle)
  eq(#e.tasks, 0); eq(e.activations, 0)
end)
test("local link focuses exact pane and raises app only after success", function()
  local e = fixture(); e.handler("herdr-focus", {pane = "p12"})
  eq(table.concat(e.tasks[1].args, "|"), "herdr-app|do|pane.focus|--pane|p12")
  eq(e.activations, 0); e.tasks[1].done(true, "{}"); eq(e.activations, 1)
end)
test("remote encoded ID is decoded for direct argv", function()
  local e = fixture()
  e.handler("herdr-focus", {pane = "devserver%2Fp12"}, nil,
    "hammerspoon://herdr-focus?pane=devserver%2Fp12")
  eq(e.tasks[1].args[5], "devserver/p12")
end)
test("already decoded remote ID is unchanged", function()
  local e = fixture()
  e.handler("herdr-focus", {pane = "devserver/p12"}, nil,
    "hammerspoon://herdr-focus?pane=devserver%2Fp12")
  eq(e.tasks[1].args[5], "devserver/p12")
end)
test("invalid targets never execute or fall back to current pane", function()
  local e = fixture()
  e.handler("herdr-focus", nil); e.handler("herdr-focus", {})
  for _, pane in ipairs({"", false, 12, {}, "--help", "p12;touch /tmp/bad",
      "p12\n", "p12\0", "%ZZ", "devserver%252Fp12", string.rep("p", 513)}) do
    e.handler("herdr-focus", {pane = pane}, nil, "hammerspoon://herdr-focus?pane=" .. tostring(pane))
  end
  eq(#e.tasks, 0); eq(e.activations, 0); eq(#e.notices, 13)
end)
test("encoded controls are rejected", function()
  local e = fixture()
  e.handler("herdr-focus", {pane = "p12%0A"}, nil, "hammerspoon://herdr-focus?pane=p12%0A")
  eq(#e.tasks, 0); eq(#e.notices, 1)
end)
test("failed focus reports error without activation", function()
  local e = fixture(); e.handler("herdr-focus", {pane = "pGone"})
  e.tasks[1].done(false, "pane not found"); eq(e.activations, 0); eq(#e.notices, 1)
end)
test("success does not launch a missing app", function()
  local e = fixture(); e.absent = true; e.handler("herdr-focus", {pane = "p12"})
  e.tasks[1].done(true, "{}"); eq(e.activations, 0)
end)
test("relay decoder validates framing, payload and exact pane ID", function()
  local e = fixture(); local prefix = e.mod.RELAY_PREFIX
  eq(e.mod.decodeRelayRequest(prefix .. "cDEy\31"), "p12")
  eq(e.mod.decodeRelayRequest(prefix .. "ZGV2c2VydmVyL3AxMg==\31"), "devserver/p12")
  for _, record in ipairs({prefix .. "\31", prefix .. "!\31", prefix .. "cDEy",
      prefix .. "LS1oZWxw\31", prefix .. "cDEyCg==\31", prefix .. string.rep("A", 685) .. "\31",
      "other:cDEy\31", prefix .. "cDEy\31junk"}) do
    eq(e.mod.decodeRelayRequest(record), nil)
  end
end)

local function relayFixture()
  local e = fixture()
  e.text = "original clipboard"; e.changeCount = 1; e.restores = 0
  package.loaded.herdrFocus = e.mod
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
  hs.pasteboard = {readString = function() return e.text end,
    changeCount = function() return e.changeCount end,
    watcher = {interval = function() end, new = function(callback)
      e.changed = callback; return {stop = function() end}
    end},
  }
  dofile(ROOT .. "herdrRelay.lua").setup()
  function e:deliver(record)
    self.text = record; self.changeCount = self.changeCount + 1; self.changed(record)
  end
  return e
end
test("focus relay restores rich clipboard and invokes only pane.focus", function()
  local e = relayFixture()
  e:deliver(e.mod.RELAY_PREFIX .. "ZGV2c2VydmVyL3AxMg==\31")
  eq(e.text, "original clipboard"); eq(e.restores, 1)
  eq(table.concat(e.tasks[1].args, "|"), "herdr-app|do|pane.focus|--pane|devserver/p12")
  e.changed(e.text); eq(#e.tasks, 1) -- Ignore the restore's own watcher event.
end)
test("invalid focus relay is consumed without acting", function()
  local e = relayFixture(); e:deliver(e.mod.RELAY_PREFIX .. "LS1oZWxw\31")
  eq(e.restores, 1); eq(#e.tasks, 0); eq(e.text, "original clipboard")
end)
test("web relay does not accept arbitrary application URL schemes", function()
  local e = relayFixture()
  e:deliver("\30HERDR_OPEN_URL_V1:8f26c7a14d9346b8a01e57bc649b2e3d:cDEy\31")
  eq(e.restores, 0); eq(#e.tasks, 0)
end)
print(count .. " Herdr focus tests passed")
