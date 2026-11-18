-- Offline mocks only: no app launches, shell execution, or real input.
local ROOT = "stow_modules/main/dot-hammerspoon/"
local tests = {}
local function test(name, fn) tests[#tests + 1] = {name, fn} end
local function eq(a, b) assert(a == b, "expected " .. tostring(b) .. ", got " .. tostring(a)) end
local function argvEq(a, b)
  eq(#a, #b)
  for i, v in ipairs(b) do eq(a[i], v) end
end
local ON, OFF = "on", "off"
local GRID, NATIVE, SCROLL, HINTS, VIM, EXIT, SNAP, DISABLED = "grid", "native", "scroll", "hints", "vim", "exit", "snapshot", "disabled"
local DRAG_PREP = {"neru", "run", "--stop-on-error", "action move_mouse --selection", "toggle-cursor-follow-selection --state on"}
local DRAG_OFF = {"neru", "toggle-cursor-follow-selection", "--state", "off"}

local function fixture(backend, store, mouseless)
  local e = {store = store or {}, calls = {}, pending = {}, handles = {}, bindings = {},
    dynamic = {}, watchers = {}, probes = {}, messages = {}, timers = {}, mouse = {},
    flags = {}, apps = {}, executable = "/mock/neru", watchStarts = true, probeStarts = true,
    rearms = 0, hyperHeld = false, kills = 0}
  if backend then e.store["neruNavigation.backend"] = backend end
  local docs = {
    [ON] = {enabled = true, mode = "idle"}, [OFF] = {enabled = false, mode = "idle"},
    [GRID] = {event = "mode_enter", mode = "recursive_grid"},
    [NATIVE] = {event = "mode_enter", mode = "grid"},
    [SCROLL] = {event = "mode_enter", mode = "scroll"},
    [HINTS] = {event = "mode_enter", mode = "hints"},
    [VIM] = {event = "mode_enter", mode = "vim"},
    [EXIT] = {event = "mode_exit"},
    [SNAP] = {event = "snapshot", status = {enabled = true, mode = "recursive_grid"}},
    [DISABLED] = {event = "snapshot", status = {enabled = false, mode = "recursive_grid"}},
  }
  _G._TaskEnv = {PATH = "/mock"}
  _G.hs = {
    settings = {get = function(k) return e.store[k] end, set = function(k, v) e.store[k] = v end},
    json = {decode = function(s) assert(docs[s], "malformed JSON fixture"); return docs[s] end},
    hotkey = {bind = function(mods, key, fn)
      local h = {key = key, mods = mods, fn = fn, enabled = true}
      function h:enable() self.enabled = true end
      function h:disable() self.enabled = false end
      function h:delete() self.enabled = false; self.deleted = true end
      function h:press() if self.enabled then self.fn() end end
      e.handles[#e.handles + 1] = h; return h
    end},
    application = {get = function(name) return e.apps[name] end},
    timer = {doAfter = function(_, fn) e.timers[#e.timers + 1] = fn end},
    mouse = {absolutePosition = function() return {x = 100, y = 200} end},
    eventtap = {
      checkKeyboardModifiers = function() return e.flags end,
      event = {
        types = {flagsChanged = 12, keyDown = 10, keyUp = 11, leftMouseDown = 1, leftMouseUp = 2, mouseMoved = 5, leftMouseDragged = 6},
        newMouseEvent = function(kind, point)
          local event = {kind = kind, point = point}
          function event:setFlags(flags) self.flags = flags; return self end
          function event:post() e.mouse[#e.mouse + 1] = self; return self end
          return event
        end,
      },
      new = function(_, fn)
        local tap = {callback = fn}
        function tap:start() self.active = true; return self end
        function tap:stop() self.active = false end
        return tap
      end,
    },
    task = {new = function(path, done, stream, args)
      local t = {done = done, stream = stream, path = path}
      function t:start() return (path == "/usr/bin/pgrep" and e.probeStarts or path ~= "/usr/bin/pgrep" and e.watchStarts) and self or false end
      function t:terminate() self.terminated = true end
      function t:setEnvironment(env) self.env = env end
      function t:emit(chunk) return self.stream(self, chunk) end
      if path == "/usr/bin/pgrep" then
        eq(stream[1], "-x"); assert(stream[2] == "neru" or stream[2] == "mouseless")
        t.procName = stream[2]; e.probes[#e.probes + 1] = t
      else argvEq(args, {"watch", "--event", "mode_enter,mode_exit"}); e.watchers[#e.watchers + 1] = t end
      return t
    end},
  }
  package.loaded.shell = {
    resolvePath = function() return e.executable end,
    task = function(args, done)
      local c = {args = args, done = done}; e.calls[#e.calls + 1] = c
      local drag = args[2] == "toggle-cursor-follow-selection" or args[4] == "action move_mouse --selection"
      if done and drag and not e.asyncDrag then done(true, "")
      elseif done then e.pending[#e.pending + 1] = c end
    end,
  }
  e.layoutChanges = {}
  package.loaded.neruLayouts = {
    current = function() return "recursive" end,
    select = function(name) e.layoutChanges[#e.layoutChanges + 1] = name; return false end,
  }
  package.loaded.neruConfigWatcher = {start = function(reload)
    e.configReload = reload
    return {markCurrent = function() e.layoutMarked = true end, stop = function() e.configWatcherStopped = true end}
  end}
  package.loaded.caps_hyper = {rearm = function() e.rearms = e.rearms + 1 end, isHeld = function() return e.hyperHeld end,
    onTap = function(fn) e.capsTapFn = fn; return function() e.capsTapFn = nil end end}
  package.loaded.palette = {
    registerBinding = function(name, fn) e.bindings[name] = fn end,
    registerDynamicBinding = function(id, fn) e.dynamic[id] = fn end,
  }
  package.loaded.preset = {displayMessage = function(text) e.messages[#e.messages + 1] = text end}
  local Mode = dofile(ROOT .. "mode.lua").Mode
  local mod = dofile(ROOT .. "neruNavigation.lua")
  e.module = mod
  local ctx = {default = setmetatable({}, Mode), hyper = {"ctrl", "alt", "cmd"}}
  function e:setup() self.state = mod.setup(ctx) end
  function e:profile(id) self.dynamic[id]().fn() end
  function e:reply(args, ok, output)
    local c = table.remove(self.pending, 1); assert(c, "missing task"); argvEq(c.args, args); c.done(ok, output or "")
  end
  function e:enabled(value) for _, h in ipairs(self.state.handles) do eq(h.enabled, value) end end
  function e:key(key, modifier)
    for _, h in ipairs(self.state.handles) do
      if h.key == key and (not modifier or (#h.mods == 1 and h.mods[1] == modifier)) then h:press(); return end
    end
    error(key)
  end
  function e:emit(line) return self.state.watch:emit(line .. "\n") end
  function e:flagsChanged(flags, raw)
    self.flags = flags
    return self.state.dragTap.callback({getFlags = function() return flags end,
      getType = function() return 12 end,
      getRawEventData = function() return {CGEventData = {flags = raw or 0}} end})
  end
  function e:bareKey(key)
    return self.state.dragTap.callback({getType = function() return 10 end,
      getKeyCode = function() return key == "Space" and 49 or 36 end,
      getFlags = function() return {} end})
  end
  function e:releaseKey(key)
    return self.state.dragTap.callback({getType = function() return 11 end,
      getKeyCode = function() return key == "Space" and 49 or 36 end})
  end
  function e:noOpens() for _, c in ipairs(self.calls) do assert(c.args[1] ~= "open") end end
  function e:noPending() eq(#self.pending, 0) end
  function e:tick() local fn = table.remove(self.timers, 1); assert(fn, "missing timer"); fn() end
  function e:mouseless(exits)
    local app = {}; function app:kill() e.kills = e.kills + 1; if exits then e.apps.Mouseless = nil end end
    self.apps.Mouseless = app
  end
  if mouseless then e:mouseless(true) end
  e:setup()
  return e
end
local function fallback(e, statusOK, output)
  e:profile("neru.fallback"); e:enabled(false)
  eq(e.store["neruNavigation.backend"], "disarmed")
  e:reply({"neru", "stop"}, true); e:noOpens()
  e:reply({"neru", "status", "--json"}, statusOK, output)
end

test("default startup launches nothing and frees F16/Hyper+;", function()
  local e = fixture(); e:enabled(false); e:key("F16"); e:key(";"); e:noPending(); e:noOpens()
  eq(e.state.backend, "mouseless"); eq(e.store["neruNavigation.backend"], nil)
  e.bindings["Neru: UI Hints"](); e:noPending()
end)
test("persisted Neru profile registers real Mode handles and watch", function()
  local e = fixture("neru"); e:enabled(true); eq(#e.watchers, 1); e:noOpens()
  eq(e.state.handles[1], e.handles[1]); eq(e.rearms, 2)
end)
test("persisted disarmed survives reload", function()
  local e = fixture("disarmed"); eq(e.state.backend, "disarmed"); e:enabled(false); e:noOpens()
end)
test("independently running Mouseless prevents startup interception", function()
  local e = fixture("neru", nil, true); eq(e.state.backend, "mouseless"); e:enabled(false); eq(e.kills, 0)
end)
test("distinct hints, manual recursive, text and scroll launchers", function()
  local e = fixture("neru")
  e:key(";"); e:reply({"neru", "hints", "--strategy", "axtree", "--action", "left_click", "--toggle"}, true)
  e:key("F16"); e:reply({"neru", "grid", "--cursor-selection-mode", "hold", "--toggle"}, true)
  e:key(","); e:reply({"neru", "vim", "--toggle"}, true)
  e:key("d"); e:reply({"neru", "scroll", "--toggle"}, true); e:noOpens(); e:noPending()
end)
test("failed launch never silently opens Mouseless", function()
  local e = fixture("neru"); e:key("F16")
  e:reply({"neru", "grid", "--cursor-selection-mode", "hold", "--toggle"}, false); e:noOpens()
end)
test("missing CLI preflight keeps Mouseless running", function()
  local e = fixture(); e.executable = nil; e:mouseless(true); e:profile("neru.use")
  eq(e.kills, 0); eq(e.store["neruNavigation.backend"], nil); e:noOpens()
end)
test("successful handoff commits only after readiness and idle", function()
  local e = fixture(); e:mouseless(true); e:profile("neru.use"); eq(e.kills, 1)
  eq(e.store["neruNavigation.backend"], "disarmed")
  e:reply({"open", "-a", "Neru"}, true); e:reply({"neru", "status", "--json"}, true, OFF)
  e:reply({"neru", "start"}, true); e:enabled(false)
  e:reply({"neru", "idle"}, true); e:enabled(true); eq(e.store["neruNavigation.backend"], "neru")
end)
test("failed handoff persists disarmed and remains so after reload", function()
  local e = fixture("neru"); fallback(e, true, ON); e:noOpens()
  eq(e.store["neruNavigation.backend"], "disarmed"); e:setup(); e:enabled(false); eq(e.state.backend, "disarmed")
end)
test("app-open failure remains disarmed", function()
  local e = fixture(); e:profile("neru.use"); e:reply({"open", "-a", "Neru"}, false)
  eq(e.store["neruNavigation.backend"], "disarmed"); e:enabled(false)
end)
test("fallback requires confirmed paused daemon", function()
  local e = fixture("neru"); fallback(e, true, OFF)
  e:reply({"open", "-a", "Mouseless"}, true); eq(e.store["neruNavigation.backend"], "mouseless"); e:enabled(false)
end)
for _, code in ipairs({0, 1, 2, 127}) do
  test("missing IPC pgrep exit " .. code .. " is handled explicitly", function()
    local e = fixture("neru"); fallback(e, false, ""); e:noOpens()
    e.state.probe.done(code)
    if code == 1 then e:reply({"open", "-a", "Mouseless"}, true); eq(e.state.backend, "mouseless")
    else e:noOpens(); eq(e.state.backend, "disarmed") end
  end)
end
test("fragmented watch frames and malformed lines", function()
  local e = fixture("neru"); e.state.watch:emit("snap"); eq(e.state.mode, "idle")
  e.state.watch:emit("shot\nscroll\ninvalid\n"); eq(e.state.mode, "scroll")
end)
test("late streaming callback cannot revive a terminated watch", function()
  local e = fixture("neru"); local w = e.state.watch
  e:emit(GRID); e:flagsChanged({ctrl = true, shift = true}); eq(#e.mouse, 1)
  w.done(1); eq(e.state.dragHeld, false); eq(#e.mouse, 2)
  eq(w.stream(nil, GRID .. "\n"), false); eq(w:emit(GRID .. "\n"), false); eq(e.state.mode, "idle")
end)
test("rapid hold/release posts ordered local events with no CLI down", function()
  local e = fixture("neru"); e:emit(GRID)
  e:flagsChanged({ctrl = true, shift = true}); e:flagsChanged({})
  eq(#e.mouse, 2); eq(e.mouse[1].kind, 1); eq(e.mouse[2].kind, 2)
  eq(next(e.mouse[1].flags), nil); eq(e.mouse[1].point.x, 100); e:noPending()
end)
test("Neru mouseMoved is converted to a drag only while locally held", function()
  local e = fixture("neru"); e:emit(GRID)
  local movement = {kind = 5, flags = {ctrl = true}}
  function movement:getType() return self.kind end
  function movement:setType(kind) self.kind = kind; return self end
  function movement:setFlags(flags) self.flags = flags; return self end
  e.state.dragTap.callback(movement); eq(movement.kind, 5)
  e:flagsChanged({ctrl = true, shift = true})
  e.state.dragTap.callback(movement); eq(movement.kind, 6); eq(next(movement.flags), nil)
  e:flagsChanged({}); movement.kind = 5
  e.state.dragTap.callback(movement); eq(movement.kind, 5)
end)
test("duplicate modifiers do not duplicate posts", function()
  local e = fixture("neru"); e:emit(GRID)
  e:flagsChanged({ctrl = true, shift = true}); e:flagsChanged({ctrl = true, shift = true}); eq(#e.mouse, 1)
  e:flagsChanged({}); e:flagsChanged({}); eq(#e.mouse, 2)
end)
test("modifiers held before mode entry are reconciled", function()
  local e = fixture("neru"); e:flagsChanged({ctrl = true, shift = true}); eq(#e.mouse, 0)
  e:emit(GRID); eq(e.state.dragHeld, true); eq(#e.mouse, 1)
end)
test("mode exit releases even if modifiers remain held", function()
  local e = fixture("neru"); e:emit(GRID); e:flagsChanged({ctrl = true, shift = true})
  e:emit(EXIT); eq(e.state.dragHeld, false); eq(#e.mouse, 2)
end)
test("mode entry without exit and disabled snapshots release", function()
  local e = fixture("neru"); e:emit(GRID); e:flagsChanged({ctrl = true, shift = true})
  e:emit(HINTS); eq(e.state.dragHeld, false); eq(#e.mouse, 2)
  e:emit(SNAP); eq(e.state.dragHeld, true); e:emit(DISABLED); eq(e.state.dragHeld, false)
end)
test("Hyper and nonmouse modes never start dragging", function()
  local e = fixture("neru"); e:emit(GRID); e.hyperHeld = true; e:flagsChanged({ctrl = true, shift = true})
  eq(#e.mouse, 0); e.hyperHeld = false
  e:flagsChanged({ctrl = true, shift = true, cmd = true}); e:flagsChanged({ctrl = true, shift = true, alt = true})
  e:emit(HINTS); e:flagsChanged({ctrl = true, shift = true}); eq(#e.mouse, 0)
end)
test("watch startup failure leaves drag unavailable", function()
  local e = fixture(); e.watchStarts = false; e.store["neruNavigation.backend"] = "neru"; e:setup()
  eq(e.state.watch, nil); e:flagsChanged({ctrl = true, shift = true}); eq(#e.mouse, 0)
end)
test("handoff releases locally before queued lifecycle requests", function()
  local e = fixture("neru"); e:emit(GRID); e:flagsChanged({ctrl = true, shift = true})
  e:profile("neru.fallback"); eq(#e.mouse, 2); eq(e.state.dragHeld, false)
  e:reply({"neru", "stop"}, true); e:reply({"neru", "status", "--json"}, true, OFF)
  e:reply({"open", "-a", "Mouseless"}, true)
end)
test("close deletes handles and releases drag before idle", function()
  local e = fixture("neru"); e:emit(GRID); e:flagsChanged({ctrl = true, shift = true})
  local watch = e.state.watch; e.state.close(); eq(#e.mouse, 2)
  for _, h in ipairs(e.state.handles) do assert(h.deleted) end
  eq(e.state.dragTap.active, false); eq(watch:emit(GRID .. "\n"), false)
  argvEq(e.calls[#e.calls].args, {"neru", "idle"})
end)

test("restart Neru quits Mouseless and its old instance before opening", function()
  local e = fixture("neru"); e:mouseless(true)
  e.state.restartNeru(); eq(e.state.exitProbe.procName, "mouseless")
  e:noOpens(); eq(e.store["neruNavigation.backend"], "disarmed")
  e.state.exitProbe.done(0)
  e:reply({"killall", "-TERM", "mouseless"}, true); e:noOpens(); e:tick()
  e.state.exitProbe.done(1); eq(e.state.exitProbe.procName, "neru")
  e.state.exitProbe.done(0)
  e:reply({"killall", "-TERM", "neru"}, true); e:noOpens(); e:tick()
  e.state.exitProbe.done(1)
  e:reply({"open", "-a", "Neru"}, true)
  e:reply({"neru", "status", "--json"}, true, ON)
  e:reply({"neru", "idle"}, true); e:enabled(true); eq(e.state.backend, "neru")
end)
test("restart Mouseless quits Neru and itself before opening only Mouseless", function()
  local e = fixture("neru"); e:mouseless(true)
  e.state.restartMouseless(); eq(e.state.exitProbe.procName, "neru")
  e.state.exitProbe.done(0)
  e:reply({"killall", "-TERM", "neru"}, true); e:noOpens(); e:tick()
  e.state.exitProbe.done(1); eq(e.state.exitProbe.procName, "mouseless")
  e.state.exitProbe.done(0)
  e:reply({"killall", "-TERM", "mouseless"}, true); e:noOpens(); e:tick()
  e.state.exitProbe.done(1)
  e:reply({"neru", "stop"}, false)
  e:reply({"neru", "status", "--json"}, false)
  e.state.probe.done(1)
  e:reply({"open", "-a", "Mouseless"}, true); e:enabled(false); eq(e.state.backend, "mouseless")
end)
test("restart starts Neru when neither navigation app is running", function()
  local e = fixture(); e.state.restartNeru()
  e.state.exitProbe.done(1); e.state.exitProbe.done(1)
  e:reply({"open", "-a", "Neru"}, true)
  e:reply({"neru", "status", "--json"}, true, ON)
  e:reply({"neru", "idle"}, true); eq(e.state.backend, "neru")
end)
test("restart does not quit Mouseless when Neru is not installed", function()
  local e = fixture(); e.executable = nil; e:mouseless(true); e.state.restartNeru()
  eq(e.kills, 0); eq(#e.probes, 0); e:noOpens()
end)
test("restart fails closed if competitor process check errors", function()
  local e = fixture("neru"); e.state.restartMouseless(); e.state.exitProbe.done(2)
  eq(e.state.backend, "disarmed"); e:enabled(false); e:noOpens(); e:noPending()
end)
test("restart waits for actual process exit rather than successful killall", function()
  local e = fixture(); e.state.restartNeru(); e.state.exitProbe.done(0)
  e:reply({"killall", "-TERM", "mouseless"}, true)
  for _ = 1, 40 do e:tick(); e.state.exitProbe.done(0) end
  eq(e.state.backend, "disarmed"); eq(e.state.busy, false); e:noOpens()
end)
test("close cancels a pending restart exit probe without opening an app", function()
  local e = fixture(); e.state.restartNeru(); local p = e.state.exitProbe
  e.state.close(); assert(p.terminated); p.done(1); e:noOpens()
end)

test("normal confirmed clicks close the mode after Neru performs the click", function()
  local e = fixture("neru"); e:emit(GRID); e.module.afterClick()
  e:reply({"neru", "idle"}, true); e:noPending()
end)
test("continuous clicks toggle persistently and reset to the base layer", function()
  local e = fixture("neru"); e:emit(GRID); e:key("F16", "cmd")
  eq(e.store["neruNavigation.continuous"], true); e.module.afterClick()
  e:reply({"neru", "run", "action reset"}, true)
  e:key("F16", "cmd"); eq(e.store["neruNavigation.continuous"], false)
  assert(not e.messages[#e.messages]:find("/", 1, true), "continuous message must not name a shortcut")
  e.module.afterClick(); e:reply({"neru", "idle"}, true)
end)
test("continuous hints add native repeat", function()
  local e = fixture("neru"); e.module.toggleContinuous(); e:key(";")
  e:reply({"neru", "hints", "--strategy", "axtree", "--action", "left_click", "--toggle", "--repeat"}, true)
end)
test("Mouseless preset stays separate from the regular Grid binding", function()
  local e = fixture("neru"); e.dynamic["neru.Grid"]().fn()
  eq(e.layoutChanges[#e.layoutChanges], "mouseless")
  e:reply({"neru", "run", "recursive_grid --cursor-selection-mode hold --toggle"}, true)
  e:key("F16")
  e:reply({"neru", "grid", "--cursor-selection-mode", "hold", "--toggle"}, true)
end)
test("continuous regular Grid resets without leaving the mode", function()
  local e = fixture("neru"); e:emit(NATIVE); e:key("F16", "cmd")
  e.module.afterClick(); e:reply({"neru", "run", "action reset"}, true)
  eq(e.state.mode, "grid"); eq(e.state.continuous, true)
end)
test("move-only confirms a selection without any mouse click", function()
  local e = fixture("neru"); e:emit(NATIVE); e.module.moveOnly()
  e:reply({"neru", "action", "move_mouse", "--selection"}, true)
  e:reply({"neru", "run", "action reset"}, true); eq(#e.mouse, 0)
end)
test("Space stays (reset) while Enter exits, regardless of continuous", function()
  local e = fixture("neru"); e:emit(NATIVE)
  e.module.afterClick("stay"); e:reply({"neru", "run", "action reset"}, true)
  e.module.afterClick("exit"); e:reply({"neru", "idle"}, true); e:noPending()
end)
test("move-only Enter variant exits after moving", function()
  local e = fixture("neru"); e:emit(NATIVE); e.module.moveOnly(true)
  e:reply({"neru", "action", "move_mouse", "--selection"}, true)
  e:reply({"neru", "idle"}, true); eq(#e.mouse, 0)
end)
test("move-only at Grid root falls back to the real pointer without clicking", function()
  local e = fixture("neru"); e:emit(NATIVE); e.module.moveOnly()
  e:reply({"neru", "action", "move_mouse", "--selection"}, false)
  e:reply({"neru", "action", "move_mouse", "--bare"}, true)
  e:reply({"neru", "run", "action reset"}, true); eq(#e.mouse, 0)
end)
test("move-only cleanup resets Grid when continuous is enabled", function()
  local e = fixture("neru"); e:emit(NATIVE); e:key("F16", "cmd"); e.module.moveOnly()
  e:reply({"neru", "action", "move_mouse", "--selection"}, true)
  e:reply({"neru", "run", "action reset"}, true); eq(#e.mouse, 0)
end)
test("late mouse click cleanup never closes Vim", function()
  local e = fixture("neru"); e.state.mode = "vim"; e.module.afterClick(); e:noPending()
end)

test("Cmd+F16 opens Recursive Grid from idle", function()
  local e = fixture("neru"); e:key("F16", "cmd")
  e:reply({"neru", "run", "recursive_grid --cursor-selection-mode hold --toggle"}, true)
  eq(e.state.continuous, false)
end)
test("Cmd+F16 toggles continuous clicks in every active mode", function()
  for _, mode in ipairs({GRID, NATIVE, SCROLL, VIM}) do
    local e = fixture("neru"); e:emit(mode); e:key("F16", "cmd")
    eq(e.state.continuous, true); e:noPending()
    e:key("F16", "cmd"); eq(e.state.continuous, false); e:noPending()
  end
  local hints = fixture("neru"); hints:emit(HINTS); hints:key("F16", "cmd")
  eq(hints.state.continuous, true)
  hints:reply({"neru", "run", "idle", "hints --strategy axtree --action left_click --repeat"}, true)
end)
test("raw modifier events no longer activate grids or bypass fallback", function()
  local e = fixture("neru"); e:flagsChanged({cmd = true, shift = true}, 4); e:noPending()
  local fallback = fixture(); fallback:key("F16", "cmd"); fallback:noPending()
end)

test("hold-aim drag release during preparation never posts mouse-down", function()
  local e = fixture("neru"); e.asyncDrag = true; e:emit(GRID)
  e:flagsChanged({ctrl = true, shift = true}); eq(#e.mouse, 0)
  e:flagsChanged({}); e:reply(DRAG_PREP, true)
  e:reply(DRAG_OFF, true); eq(#e.mouse, 0); e:noPending()
end)
test("hold-aim drag serializes release cleanup before a new drag", function()
  local e = fixture("neru"); e.asyncDrag = true; e:emit(GRID)
  e:flagsChanged({ctrl = true, shift = true}); e:reply(DRAG_PREP, true); eq(#e.mouse, 1)
  e:flagsChanged({}); eq(#e.mouse, 2)
  e:flagsChanged({ctrl = true, shift = true}); eq(#e.pending, 1)
  e:reply(DRAG_OFF, true); eq(#e.pending, 1)
  e:reply(DRAG_PREP, true); eq(#e.mouse, 3)
end)
test("failed follow cleanup blocks further mouse-downs until restart", function()
  local e = fixture("neru"); e.asyncDrag = true; e:emit(GRID)
  e:flagsChanged({ctrl = true, shift = true}); e:reply(DRAG_PREP, true)
  e:flagsChanged({}); e:reply(DRAG_OFF, false)
  assert(e.state.dragCleanupBlocked); assert(e.state.dragFollowing)
  e:flagsChanged({ctrl = true, shift = true}); eq(#e.mouse, 2); e:noPending()
end)
test("partial drag preparation failure restores hold and never presses", function()
  local e = fixture("neru"); e.asyncDrag = true; e:emit(GRID)
  e:flagsChanged({ctrl = true, shift = true}); e:reply(DRAG_PREP, false)
  assert(e.state.dragFollowing); eq(#e.mouse, 0)
  e:reply(DRAG_OFF, true); eq(e.state.dragFollowing, false); e:noPending()
end)
test("old drag preparation cannot press after a mode transition", function()
  local e = fixture("neru"); e.asyncDrag = true; e:emit(GRID)
  e:flagsChanged({ctrl = true, shift = true}); e:emit(EXIT); e:emit(NATIVE)
  e:reply(DRAG_PREP, true); eq(#e.mouse, 0)
  e:reply(DRAG_OFF, true); e:reply(DRAG_PREP, true); eq(#e.mouse, 1)
end)

test("saved config hot reload checks readiness and reloads the daemon", function()
  local e = fixture("neru"); e.configReload()
  e:reply({"neru", "status", "--json"}, true, ON)
  e:reply({"neru", "config", "reload"}, true); e:noOpens()
end)
test("saved config does not start an absent daemon", function()
  local e = fixture("neru"); e.configReload()
  e:reply({"neru", "status", "--json"}, false); e:noPending(); e:noOpens()
end)

test("Ctrl hold resets Grid and bare Space drops without an extra click", function()
  local e = fixture("neru"); e:emit(NATIVE); e.module.startHold()
  e:reply({"neru", "action", "move_mouse", "--selection"}, true)
  e:reply({"neru", "run", "action reset"}, true)
  eq(#e.mouse, 1); eq(e.mouse[1].kind, 1); e:flagsChanged({})
  eq(#e.mouse, 1); eq(e:bareKey("Space"), true)
  e:reply({"neru", "action", "move_mouse", "--selection"}, true)
  e:reply({"neru", "idle"}, true)
  eq(#e.mouse, 2); eq(e.mouse[2].kind, 2); eq(e.state.dragLatched, false)
end)
test("canceling a pending Ctrl hold cannot post a late mouse-down", function()
  local e = fixture("neru"); e:emit(GRID); e.module.startHold()
  e:emit(EXIT)
  e:reply({"neru", "action", "move_mouse", "--selection"}, true)
  eq(#e.mouse, 0); eq(e.state.dragLatched, false)
end)
test("bare Space cancels a hold that has not pressed yet", function()
  local e = fixture("neru"); e:emit(NATIVE); e.module.startHold(); e:bareKey("Space")
  e:reply({"neru", "action", "move_mouse", "--selection"}, true)
  e:reply({"neru", "idle"}, true); eq(#e.mouse, 0)
end)
test("Vim Ctrl hold drops on Space and exits only on Enter", function()
  local e = fixture("neru"); e:emit(VIM); e.module.startHold()
  e:reply({"neru", "action", "feed", "--mode", "g", "h"}, true)
  eq(#e.mouse, 1); e:flagsChanged({}); eq(e:bareKey("Space"), true)
  eq(#e.mouse, 2); e:noPending(); eq(e.state.mode, "vim")
  e:releaseKey("Space")
  e.module.startHold(); e:reply({"neru", "action", "feed", "--mode", "g", "h"}, true)
  e:bareKey("Enter"); e:reply({"neru", "idle"}, true); eq(#e.mouse, 4)
end)
test("drop key repeats are suppressed until its key-up", function()
  local e = fixture("neru"); e:emit(VIM); e.module.startHold()
  e:reply({"neru", "action", "feed", "--mode", "g", "h"}, true)
  eq(e:bareKey("Space"), true); eq(#e.mouse, 2)
  eq(e:bareKey("Space"), true); eq(#e.mouse, 2)
  eq(e:releaseKey("Space"), true)
  eq(e:bareKey("Space"), false)
end)
test("overlapping Space and Enter are each suppressed through key-up", function()
  local e = fixture("neru"); e:emit(VIM); e.module.startHold()
  e:reply({"neru", "action", "feed", "--mode", "g", "h"}, true)
  eq(e:bareKey("Space"), true); eq(e:bareKey("Enter"), true)
  eq(e:bareKey("Space"), true); eq(e:bareKey("Enter"), true); eq(#e.mouse, 2)
  e:releaseKey("Space"); eq(e:bareKey("Enter"), true)
  e:releaseKey("Enter"); eq(e:bareKey("Space"), false)
end)
test("an immediate drop waits for Grid reset and releases at source", function()
  local e = fixture("neru"); e:emit(NATIVE); e.module.startHold()
  e:reply({"neru", "action", "move_mouse", "--selection"}, true)
  assert(e.state.holdResetting); eq(e:bareKey("Enter"), true)
  eq(#e.pending, 1); eq(#e.mouse, 1)
  e:reply({"neru", "run", "action reset"}, true)
  eq(#e.mouse, 2); e:reply({"neru", "idle"}, true); e:noPending()
end)
test("destination keys are gated until the base grid is ready", function()
  local e = fixture("neru"); e:emit(GRID); e.module.startHold()
  e:reply({"neru", "action", "move_mouse", "--selection"}, true)
  local key={getType=function() return 10 end,getKeyCode=function() return 0 end,getFlags=function() return {} end}
  eq(e.state.dragTap.callback(key), true)
  e:reply({"neru", "run", "action reset"}, true)
  eq(e.state.dragTap.callback(key), false)
end)
test("scroll mode auto-exits after the inactivity timer fires", function()
  local e = fixture("neru"); e:emit(SCROLL)
  e:tick() -- fire the 10s inactivity timer
  e:reply({"neru", "idle"}, true); e:noPending()
end)
test("scroll inactivity timer does not exit after the mode already left", function()
  local e = fixture("neru"); e:emit(SCROLL); e:emit(EXIT)
  e:tick(); e:noPending(); e:noOpens()
end)
test("mode exit without opacity tuning sends no reload", function()
  local e = fixture("neru"); e:emit(NATIVE); e:emit(EXIT)
  e:noPending(); e:noOpens()
end)
test("Caps tap resets an open grid but not other modes", function()
  local e = fixture("neru"); e:emit(NATIVE)
  eq(e.capsTapFn(false), true)
  e:reply({"neru", "run", "action reset"}, true)
  local hints = fixture("neru"); hints:emit(HINTS)
  eq(hints.capsTapFn(false), false); hints:noPending()
end)
test("Shift+Caps quits any Neru mode, but not idle/Mouseless", function()
  local e = fixture("neru"); e:emit(HINTS)
  eq(e.capsTapFn(true), true); e:reply({"neru", "idle"}, true)
  local idle = fixture("neru"); eq(idle.capsTapFn(true), false); idle:noPending()
  local fallback = fixture(); eq(fallback.capsTapFn(true), false); fallback:noPending()
end)
test("Right Shift exits either grid rather than switching layouts", function()
  for _,mode in ipairs({GRID,NATIVE}) do
    local e = fixture("neru"); e:emit(mode); e:key("F16")
    e:reply({"neru", "idle"}, true); e:noPending()
  end
end)
test("config watcher is stopped on shutdown", function()
  local e = fixture("neru"); e.state.close(); eq(e.configWatcherStopped, true)
end)

local failures = 0
for _, t in ipairs(tests) do
  local ok, err = xpcall(t[2], debug.traceback)
  if ok then print("PASS " .. t[1]) else failures = failures + 1; io.stderr:write("FAIL " .. t[1] .. "\n" .. err .. "\n") end
end
print(#tests .. " tests, " .. failures .. " failures")
if failures > 0 then os.exit(1) end
