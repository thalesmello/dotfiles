-- Run from the review checkout: lua tests/caps_hyper_test.lua
-- hs.task/hidutil and all keyboard APIs are mocks: no live input/remapping.
local SOURCE = "stow_modules/main/dot-hammerspoon/caps_hyper.lua"
local tests = {}
local function test(name, fn) tests[#tests + 1] = {name, fn} end
local function eq(actual, expected, label)
  assert(actual == expected, (label or "value") .. ": expected " .. tostring(expected) .. ", got " .. tostring(actual))
end

local function fixture(setup)
  local e = {now = 100, taps = {}, tasks = {}, strokes = {}, logs = {}, shutdowns = 0}
  local types = {keyDown = 10, keyUp = 11}
  _G._CapsHyperTap = nil
  _G.hs = {
    shutdownCallback = function() e.shutdowns = e.shutdowns + 1 end,
    keycodes = {map = {f19 = 80}},
    timer = {secondsSinceEpoch = function() return e.now end},
    task = {new = function(path, callback, args)
      eq(path, "/usr/bin/hidutil", "mocked remapper")
      eq(callback, nil, "fire-and-forget mapping callback")
      eq(#args, 3); eq(args[1], "property"); eq(args[2], "--set")
      local task = {payload = args[3], starts = 0, waits = 0}
      function task:start() self.starts = self.starts + 1; return self end
      function task:waitUntilExit() self.waits = self.waits + 1; return self end
      e.tasks[#e.tasks + 1] = task
      return task
    end},
    eventtap = {
      event = {types = types},
      new = function(eventTypes, fn)
        eq(#eventTypes, 2); eq(eventTypes[1], types.keyDown); eq(eventTypes[2], types.keyUp)
        local tap = {handler = fn, active = false, starts = 0, stops = 0}
        function tap:start() self.active = true; self.starts = self.starts + 1; return self end
        function tap:stop() self.active = false; self.stops = self.stops + 1; return self end
        e.taps[#e.taps + 1] = tap
        return tap
      end,
      keyStroke = function(mods, key, delay)
        eq(#mods, 0); eq(key, "escape"); eq(delay, 0)
        e.strokes[#e.strokes + 1] = key
      end,
    },
    execute = function() error("No real shell execution permitted in tests") end,
  }
  package.loaded.util = {log = function(...) e.logs[#e.logs + 1] = {...} end}
  e.module = dofile(SOURCE)
  function e:send(kind, code, flags)
    assert(_CapsHyperTap and _CapsHyperTap.active, "expected active mock tap")
    local event = {flags = flags or {}}
    function event:getType() return types[kind] end
    function event:getKeyCode() return code end
    function event:getFlags() return self.flags end
    function event:setFlags(value) self.flags = value end
    return _CapsHyperTap.handler(event), event
  end
  function e:down() return self:send("keyDown", hs.keycodes.map.f19) end
  function e:up() return self:send("keyUp", hs.keycodes.map.f19) end
  function e:rearm()
    local old, count = _CapsHyperTap, #self.taps
    self.module.rearm()
    local fresh = _CapsHyperTap
    assert(fresh ~= old, "rearm must create a fresh tap, not merely restart the old one")
    eq(#self.taps, count + 1); eq(old.active, false); eq(old.stops, 1)
    eq(fresh.active, true); eq(fresh.starts, 1)
    eq(fresh.handler, old.handler, "callback closure is preserved")
    eq(#self.tasks, 1, "rearm must not reapply hidutil")
    return fresh
  end
  if setup ~= false then e.module.setup() end
  return e
end

test("onTap listener can suppress the synthetic Escape and sees Shift", function()
  local e = fixture()
  local seen
  e.module.onTap(function(shift) seen = shift; return true end)
  e:down(); e.now = 100.05; e:up()
  eq(seen, false); eq(#e.strokes, 0, "handled tap sends no Escape")
  e:send("keyDown", hs.keycodes.map.f19, {shift = true}); e.now = 100.09; e:up()
  eq(seen, true); eq(#e.strokes, 0)
end)

test("onTap returning false keeps Escape; unregister restores it", function()
  local e = fixture()
  local off = e.module.onTap(function() return false end)
  e:down(); e.now = 100.05; e:up(); eq(#e.strokes, 1)
  off(); e.module.onTap(function() return true end)
  e:down(); e.now = 100.09; e:up(); eq(#e.strokes, 1)
end)

test("rearm before setup is inert", function()
  local e = fixture(false)
  e.module.rearm()
  eq(#e.taps, 0); eq(#e.tasks, 0); eq(e.module.isHeld(), false)
end)

test("setup remaps Caps asynchronously and rearm creates fresh taps", function()
  local e = fixture()
  eq(#e.tasks, 1); eq(e.tasks[1].starts, 1); eq(e.tasks[1].waits, 0)
  eq(e.tasks[1].payload,
    '{"UserKeyMapping":[{"HIDKeyboardModifierMappingSrc":0x700000039,"HIDKeyboardModifierMappingDst":0x70000006E}]}')
  e:rearm(); e:rearm()
  eq(#e.taps, 3); eq(e.module.isHeld(), false)
end)

test("short unused Caps hold through rearm still emits one Escape on keyup", function()
  local e = fixture()
  eq(e:down(), true); eq(e.module.isHeld(), true)
  e.now = 100.05; e:rearm(); eq(e.module.isHeld(), true)
  eq(e:up(), true); eq(e.module.isHeld(), false); eq(#e.strokes, 1)
end)

test("used hold stays used across rearm and normalizes keydown/keyUp", function()
  local e = fixture()
  local released = 0
  e.module.onRelease(function() released = released + 1 end)
  eq(e:down(), true)
  local consumed, event = e:send("keyDown", 12, {shift = true, fn = true})
  eq(consumed, false); eq(event.flags.ctrl, true); eq(event.flags.alt, true); eq(event.flags.cmd, true)
  eq(event.flags.shift, true); eq(event.flags.fn, true); eq(e.module.lastKeyCode(), 12)
  e.now = 100.04; e:rearm(); eq(e.module.isHeld(), true); eq(e.module.lastKeyCode(), 12)
  consumed, event = e:send("keyUp", 12, {shift = true})
  eq(consumed, false); eq(event.flags.ctrl, true); eq(event.flags.alt, true); eq(event.flags.cmd, true)
  eq(event.flags.shift, true)
  e.now = 100.08; eq(e:up(), true)
  eq(e.module.isHeld(), false); eq(#e.strokes, 0, "used hold must not send Escape")
  eq(released, 1)
  consumed, event = e:send("keyDown", 13, {shift = true})
  eq(consumed, false); eq(event.flags.ctrl, nil); eq(event.flags.alt, nil); eq(event.flags.cmd, nil)
  eq(e.module.lastKeyCode(), 13)
end)

test("first ordinary key after rearm marks an in-flight hold used", function()
  local e = fixture(); e:down(); e:rearm()
  local _, event = e:send("keyDown", 14)
  eq(event.flags.ctrl, true); eq(event.flags.alt, true); eq(event.flags.cmd, true)
  e.now = 100.02; e:up(); eq(#e.strokes, 0)
end)

test("rearm preserves original hold timestamp rather than restarting threshold", function()
  local e = fixture(); e:down()
  e.now = 100.20; e:rearm(); e.now = 100.21; e:up()
  eq(#e.strokes, 0, "long unused hold is not a tap")
end)

test("repeated F19 keydown after rearm does not reset used state", function()
  local e = fixture(); e:down(); e:send("keyDown", 15)
  e.now = 100.03; e:rearm(); eq(e:down(), true)
  eq(e.module.lastKeyCode(), 15); e.now = 100.04; e:up(); eq(#e.strokes, 0)
end)

test("repeated F19 keydown after rearm does not reset original down time", function()
  local e = fixture(); e:down(); e.now = 100.14; e:rearm(); e:down()
  e.now = 100.20; e:up(); eq(#e.strokes, 0)
end)

test("ordinary keyup while held stamps flags but does not mark hold used", function()
  local e = fixture(); e:down(); e:rearm()
  local _, event = e:send("keyUp", 17)
  eq(event.flags.ctrl, true); eq(event.flags.cmd, true); eq(event.flags.alt, true)
  eq(e.module.lastKeyCode(), nil)
  e.now = 100.03; e:up(); eq(#e.strokes, 1)
end)

test("release listeners survive rearm, see released state, and unregister", function()
  local e = fixture()
  local calls, remove = 0, nil
  remove = e.module.onRelease(function()
    eq(e.module.isHeld(), false); calls = calls + 1; remove()
  end)
  e:down(); e:rearm(); e.now = 100.02; e:up(); eq(calls, 1)
  e:down(); e:rearm(); e.now = 100.04; e:up(); eq(calls, 1)
  eq(#e.strokes, 2)
end)

test("a new hold resets used state after a previous used hold", function()
  local e = fixture(); e:down(); e:send("keyDown", 18)
  e.now = 100.02; e:up(); eq(#e.strokes, 0)
  e:rearm(); e.now = 100.03; e:down(); e.now = 100.05; e:up()
  eq(#e.strokes, 1)
end)

test("custom threshold and shutdown mapping restoration remain intact", function()
  local e = fixture(false); e.module.setup({threshold = 0.5})
  e:down(); e.now = 100.3; e:rearm(); e:up(); eq(#e.strokes, 1)
  hs.shutdownCallback()
  eq(#e.tasks, 2); eq(e.tasks[2].payload, '{"UserKeyMapping":[]}')
  eq(e.tasks[2].starts, 1); eq(e.tasks[2].waits, 1); eq(e.shutdowns, 1)
end)

local failed = 0
for _, entry in ipairs(tests) do
  local ok, err = xpcall(entry[2], debug.traceback)
  if ok then print("PASS " .. entry[1])
  else failed = failed + 1; io.stderr:write("FAIL " .. entry[1] .. "\n" .. err .. "\n") end
end
print(string.format("%d tests, %d failures", #tests, failed))
if failed > 0 then os.exit(1) end
