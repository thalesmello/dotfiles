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
    hint_snapshot = {event = "snapshot", status = {enabled = true, mode = "hints"}},
    grid_snapshot = {event = "snapshot", status = {enabled = true, mode = "grid"}},
    bisect = {event = "mode_enter", mode = "bisect"},
    monitor = {event = "mode_enter", mode = "monitor_select"},
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
    application = {
      get = function(name)
        assert(name ~= "Mouseless", "Mouseless lookup must not use global AX fallback")
        return e.apps[name]
      end,
      applicationsForBundleID = function(bundle)
        eq(bundle, "net.sonuscape.mouseless")
        return e.apps.Mouseless and {e.apps.Mouseless} or {}
      end,
    },
    timer = {absoluteTime = function() return (e.clock or 100) * 1e9 end, doAfter = function(delay, fn)
      local timer = {delay = delay, stopped = false}
      function timer:stop() self.stopped = true end
      e.timers[#e.timers + 1] = function() if not timer.stopped then fn() end end
      return timer
    end},
    mouse = {absolutePosition = function() return e.cursorPoint or {x = 100, y = 200} end},
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
      else argvEq(args, {"watch", "--event", "mode_enter,mode_exit,select"}); e.watchers[#e.watchers + 1] = t end
      return t
    end},
  }
  package.loaded.shell = {
    whenReady = function(fn)
      if e.store.deferPath then
        e.pathWaiters = e.pathWaiters or {}; e.pathWaiters[#e.pathWaiters + 1] = fn
      else fn(true) end
    end,
    resolvePath = function() return e.executable end,
    task = function(args, done)
      if args[1] == "neru" and args[2] ~= "run" then
        for _, arg in ipairs(args) do
          assert(arg ~= "--bail-on-error", "sequence-only flags must not be passed to standalone Neru CLI commands")
        end
      end
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
  -- Config I/O is virtual: opacity tests must never edit the live desktop config.
  function e:withConfig(fn)
    local open, rename, remove = io.open, os.rename, os.remove
    io.open = function(path, mode)
      if mode == "r" then
        if not self.config then return nil end
        return {read = function() return self.config end, close = function() end}
      end
      return {write = function(_, text) self.tmpConfig = text end, close = function() end}
    end
    os.rename = function() self.config = self.tmpConfig; self.tmpConfig = nil; return true end
    os.remove = function() self.tmpConfig = nil end
    local ok, err = pcall(fn)
    io.open, os.rename, os.remove = open, rename, remove
    if not ok then error(err) end
  end
  function e:setup() self:withConfig(function() self.state = mod.setup(ctx) end) end
  function e:opacity(delta) self:withConfig(function() self.state.adjustOpacity(delta) end) end
  function e:profile(id) self.dynamic[id]().fn() end
  function e:reply(args, ok, output)
    local expected = {table.unpack(args)}
    local c = table.remove(self.pending, 1); assert(c, "missing task"); argvEq(c.args, expected); c.done(ok, output or "")
  end
  function e:enabled(value) for _, h in ipairs(self.state.handles) do eq(h.enabled, value) end end
  function e:key(key, modifier)
    for _, h in ipairs(self.state.handles) do
      local mods = type(modifier) == "table" and modifier or modifier and {modifier} or {}
      local match = not modifier and key ~= "F16" or table.concat(h.mods, "+") == table.concat(mods, "+")
      if h.key == key and match then h:press(); return end
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
  e.bindings["Neru: Vim Search"](); e:noPending()
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
test("distinct Vim search, hints, grid, text and scroll launchers", function()
  local e = fixture("neru")
  e:key(";"); e:reply({"neru", "run", "--stop-on-error", "vim", "action feed --mode s"}, true)
  e:key("F16"); e:reply({"neru", "grid", "--cursor-selection-mode", "hold"}, true)
  e:key("F16", {"alt", "shift"}); e:reply({"neru", "grid", "--cursor-selection-mode", "hold"}, true)
  e:key(","); e:reply({"neru", "vim"}, true)
  e:key("d"); e:reply({"neru", "scroll"}, true); e:noOpens(); e:noPending()
end)
test("failed launch never silently opens Mouseless", function()
  local e = fixture("neru"); e:key("F16")
  e:reply({"neru", "grid", "--cursor-selection-mode", "hold"}, false); e:noOpens()
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
  local hasIdle, hasKarabiner = false, false
  for _, c in ipairs(e.calls) do
    if c.args[1] == "neru" and c.args[2] == "idle" then hasIdle = true end
    if c.args[1] == "karabiner_cli" then hasKarabiner = true end
  end
  assert(hasIdle, "close must idle Neru")
  assert(hasKarabiner, "close must clear the neru-grid Karabiner variable")
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
  local e = fixture("neru"); e:emit(GRID); e.module.toggleContinuous()
  eq(e.store["neruNavigation.continuous"], true); e.module.afterClick()
  e:reply({"neru", "run", "action reset"}, true)
  e.module.toggleContinuous(); eq(e.store["neruNavigation.continuous"], false)
  assert(not e.messages[#e.messages]:find("/", 1, true), "continuous message must not name a shortcut")
  e.module.afterClick(); e:reply({"neru", "idle"}, true)
end)
test("continuous hints add native repeat", function()
  local e = fixture("neru"); e.module.toggleContinuous(); e:key("F16", "cmd")
  e:reply({"neru", "hints", "--strategy", "axtree", "--action", "left_click", "--repeat"}, true)
end)
test("Hyper semicolon cancels Vim input and restarts s search without toggling closed", function()
  local e = fixture("neru"); e:emit(VIM); e:key(";")
  e:reply({"neru", "run", "--stop-on-error", "action feed --mode Escape", "vim", "action feed --mode s"}, true)
  e:noPending(); e:noOpens()
end)
test("Hyper slash opens Vim directly into slash search from non-Vim modes", function()
  for _, mode in ipairs({EXIT, HINTS, GRID, NATIVE, SCROLL}) do
    local e = fixture("neru"); e:emit(mode); e:key("/")
    e:reply({"neru", "run", "--stop-on-error", "vim", "action feed --mode /"}, true)
    e:noPending(); e:noOpens()
  end
end)
test("Hyper slash cancels Vim input and restarts slash search", function()
  local e = fixture("neru"); e:emit(VIM); e:key("/")
  e:reply({"neru", "run", "--stop-on-error", "action feed --mode Escape", "vim", "action feed --mode /"}, true)
  e:noPending(); e:noOpens()
end)
test("Hyper comma cancels pending Vim input and opens Normal mode", function()
  local e = fixture("neru"); e:emit(VIM); e:key(",")
  e:reply({"neru", "run", "--stop-on-error", "action feed --mode Escape", "vim"}, true)
  e:noPending()
end)
test("Hyper comma opens Normal Vim from every other mode", function()
  for _, mode in ipairs({EXIT, HINTS, GRID, NATIVE, SCROLL, "bisect", "monitor"}) do
    local e = fixture("neru"); e:emit(mode); e:key(",")
    e:reply({"neru", "vim"}, true); e:noPending()
  end
end)
test("Hyper d enters Scroll from other modes and pages down inside Scroll", function()
  for _, mode in ipairs({EXIT, HINTS, GRID, NATIVE, VIM, "bisect", "monitor"}) do
    local e = fixture("neru"); e:emit(mode); e:key("d")
    e:reply({"neru", "scroll"}, true); e:emit(SCROLL); e:key("d")
    e:reply({"neru", "action", "page_down"}, true); e:key("d")
    e:reply({"neru", "action", "page_down"}, true); e:noPending()
  end
  local fallback = fixture(); fallback:key("d"); fallback:noPending()
end)
test("Vim search launcher is disabled in fallback and disarmed profiles", function()
  for _, backend in ipairs({"mouseless", "disarmed"}) do
    local e = fixture(backend); e:key(";"); e:key(","); e:key("/"); e:noPending()
    e.bindings["Neru: Vim Search"](); e.bindings["Neru: Vim Slash Search"](); e:noPending()
  end
end)
test("Mouseless preset stays separate from the regular Grid binding", function()
  local e = fixture("neru"); e.dynamic["neru.Grid"]().fn()
  eq(e.layoutChanges[#e.layoutChanges], "mouseless")
  e:reply({"neru", "run", "recursive_grid --cursor-selection-mode hold --toggle"}, true)
  e:key("F16", {"alt", "shift"})
  e:reply({"neru", "grid", "--cursor-selection-mode", "hold"}, true)
end)
test("continuous regular Grid resets without leaving the mode", function()
  local e = fixture("neru"); e:emit(NATIVE); e.module.toggleContinuous()
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
  local e = fixture("neru"); e:emit(NATIVE); e.module.toggleContinuous(); e.module.moveOnly()
  e:reply({"neru", "action", "move_mouse", "--selection"}, true)
  e:reply({"neru", "run", "action reset"}, true); eq(#e.mouse, 0)
end)
test("late mouse click cleanup never closes Vim", function()
  local e = fixture("neru"); e.state.mode = "vim"; e.module.afterClick(); e:noPending()
end)

test("Cmd+F16 always opens Hints without changing continuous clicks", function()
  for _, continuous in ipairs({false, true}) do
    for _, mode in ipairs({EXIT, HINTS, GRID, NATIVE, SCROLL, VIM, "bisect", "monitor"}) do
      local e = fixture("neru", {["neruNavigation.lastPointerMode"] = "grid",
        ["neruNavigation.continuous"] = continuous})
      e:emit(mode); e:key("F16", "cmd")
      local args = {"neru", "hints", "--strategy", "axtree", "--action", "left_click"}
      if continuous then args[#args + 1] = "--repeat" end
      e:reply(args, true); eq(e.state.continuous, continuous); e:noPending()
    end
  end
end)
test("Cmd+Shift+F16 toggles continuous clicks in every mode including Idle", function()
  for _, mode in ipairs({EXIT, HINTS, GRID, NATIVE, SCROLL, VIM, "bisect", "monitor"}) do
    local e = fixture("neru"); e:emit(mode); e:key("F16", {"cmd", "shift"})
    eq(e.state.continuous, true); eq(e.store["neruNavigation.continuous"], true)
    if mode == HINTS then
      e:reply({"neru", "run", "idle", "hints --strategy axtree --action left_click --repeat"}, true)
    end
    e:key("F16", {"cmd", "shift"}); eq(e.state.continuous, false)
    if mode == HINTS then
      e:reply({"neru", "run", "idle", "hints --strategy axtree --action left_click"}, true)
    end
    e:noPending()
  end
end)
test("Ctrl+F16 opens Recursive Grid directly from every mode including Recursive Grid", function()
  for _, mode in ipairs({EXIT, HINTS, GRID, NATIVE, SCROLL, VIM}) do
    local e = fixture("neru"); e:emit(mode); e:key("F16", "ctrl")
    e:reply({"neru", "run", "recursive_grid --cursor-selection-mode hold"}, true)
    eq(e.state.continuous, false); e:noPending()
  end
  local e = fixture(); e:key("F16", "ctrl"); e:noPending()
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
test("Caps tap invokes native reset-or-exit in grids, not other modes", function()
  local e = fixture("neru"); e:emit(NATIVE)
  eq(e.capsTapFn(false), true)
  e:reply({"neru", "run", "action reset --toggle"}, true)
  local hints = fixture("neru"); hints:emit(HINTS)
  eq(hints.capsTapFn(false), false); hints:noPending()
end)
test("Shift+Caps quits any Neru mode, but not idle/Mouseless", function()
  local e = fixture("neru"); e:emit(HINTS)
  eq(e.capsTapFn(true), true); e:reply({"neru", "idle"}, true)
  local idle = fixture("neru"); eq(idle.capsTapFn(true), false); idle:noPending()
  local fallback = fixture(); eq(fallback.capsTapFn(true), false); fallback:noPending()
end)
test("grid modes publish the neru-grid Karabiner variable", function()
  local e = fixture("neru"); e:emit(NATIVE)
  local found
  for _, c in ipairs(e.calls) do if c.args[1] == "karabiner_cli" then found = c.args end end
  argvEq(found, {"karabiner_cli", "--set-variables", '{"neru-grid":1}'})
  e:emit(EXIT)
  for _, c in ipairs(e.calls) do if c.args[1] == "karabiner_cli" then found = c.args end end
  argvEq(found, {"karabiner_cli", "--set-variables", '{"neru-grid":0}'})
end)
local function opacityFixture(mode, alpha, level)
  local e = fixture("neru", {["neruNavigation.gridOpacity"] = level or 0.5})
  e.config = '[recursive_grid.ui]\nhighlight_color = "#' .. (alpha or "80") .. '180C10"\n' ..
    'line_color = "#8CB87671"\n[grid.ui]\nbackground_color = "#' .. (alpha or "80") .. '180C10"\n' ..
    'matched_background_color = "#' .. (alpha or "80") .. '180C10"\nline_color = "#00000000"\n'
  e:emit(mode or NATIVE)
  return e
end
test("opacity burst waits 300ms and updates the same grid only once", function()
  for _, mode in ipairs({NATIVE, GRID}) do
    local e = opacityFixture(mode)
    e:opacity(-0.05); e:opacity(-0.05); e:opacity(0.05)
    eq(e.state.opacityTimer.delay, 0.3); e:noPending()
    e:tick(); e:tick(); e:noPending() -- superseded timers cannot redraw
    e:tick()
    e:reply({"neru", "set-grid-opacity", "--value", "0.4500"}, true)
    e:noPending(); eq(e.state.opacityPending, false)
    eq(e.state.mode, mode == GRID and "recursive_grid" or "grid")
    assert(e.config:find('line_color = "#8CB87671"', 1, true))
    assert(e.config:find('line_color = "#00000000"', 1, true))
    eq(select(2, e.config:gsub('#73180C10', '')), 3)
  end
end)
test("opacity at the 5 percent floor is a valid no-op, not missing color", function()
  local e = opacityFixture(NATIVE, "0D", 0.05)
  e:opacity(-0.05); e:opacity(-0.05)
  eq(e.store["neruNavigation.gridOpacity"], 0.05)
  eq(e.messages[#e.messages], "Grid opacity 5%")
  eq(#e.timers, 0); e:noPending()
end)
test("opacity clamps low and high saved values", function()
  local e = opacityFixture(NATIVE, "00", 0)
  e:opacity(-0.05)
  eq(e.store["neruNavigation.gridOpacity"], 0.05)
  eq(select(2, e.config:gsub('#0D180C10', '')), 3)
  local high = opacityFixture(NATIVE, "F2", 0.95)
  high:opacity(0.05); eq(high.store["neruNavigation.gridOpacity"], 0.95)
  eq(#high.timers, 0)
end)
test("missing opacity colors report an error without changing settings", function()
  local e = opacityFixture(); e.config = '[grid.ui]\n'
  e:opacity(-0.05)
  eq(e.messages[#e.messages], "Grid colors not found in Neru config")
  eq(e.store["neruNavigation.gridOpacity"], 0.5); eq(#e.timers, 0)
end)
test("closing before opacity debounce loads colors but never reopens", function()
  local e = opacityFixture(); e:opacity(-0.05); e:emit(EXIT)
  e:reply({"neru", "set-grid-opacity", "--value", "0.4500"}, true)
  e:tick(); e:noPending(); eq(e.state.opacityPending, false)
end)
test("new mode during live opacity update stays in the new mode", function()
  local e = opacityFixture(); e:opacity(-0.05); e:tick(); e:emit(EXIT); e:emit(VIM)
  e:reply({"neru", "set-grid-opacity", "--value", "0.4500"}, true); e:noPending()
  eq(e.state.mode, "vim")
end)
test("Escape during live opacity update never reopens", function()
  local e = opacityFixture(); e:opacity(-0.05); e:tick(); e:emit(EXIT)
  e.state.inputHandler({getType = function() return 10 end, getKeyCode = function() return 53 end})
  e:reply({"neru", "set-grid-opacity", "--value", "0.4500"}, true); e:noPending()
end)
test("failed live opacity update reports the local build requirement", function()
  local e = opacityFixture(); e:opacity(-0.05); e:tick()
  e:reply({"neru", "set-grid-opacity", "--value", "0.4500"}, false); e:noPending()
  eq(e.messages[#e.messages], "Live opacity needs the local Neru build")
end)
test("shutdown cancels a pending opacity redraw", function()
  local e = opacityFixture(); e:opacity(-0.05); e.state.close()
  e:tick(); e:noPending()
end)
local CLICK_STAY = {"neru", "run", "--stop-on-error", "action reset", "action left_click --bare --bail-on-error", "peek-grid --duration 5s --opacity 0.25"}
local CLICK_EXIT = {"neru", "run", "--stop-on-error", "action left_click --bare --bail-on-error", "idle"}
test("macro IPC dispatch returns before rearming taps or issuing Neru requests", function()
  local e = fixture("neru"); e:emit(NATIVE); e.state.continuous = true
  local calls, rearms = #e.calls, e.rearms
  e.module.dispatch("confirm_left_stay")
  eq(#e.calls, calls); eq(e.rearms, rearms); e:noPending()
  e:tick(); e:reply({"neru", "action", "move_mouse", "--selection"}, true)
  e:reply(CLICK_STAY, true); eq(next(e.state.macroTimers), nil); e:noPending()
end)
test("two rapid macro IPC requests become two serial clicks at the same target", function()
  local e = fixture("neru"); e:emit(NATIVE); e.state.continuous = true
  e.module.dispatch("confirm_left_stay"); e.module.dispatch("confirm_left_stay")
  e:noPending(); e:tick(); e:tick(); eq(#e.pending, 1)
  e:reply({"neru", "action", "move_mouse", "--selection"}, true)
  e:reply(CLICK_STAY, true)
  e:reply({"neru", "action", "move_mouse", "--x", "100", "--y", "200"}, true)
  e:reply(CLICK_STAY, true); e:noPending(); eq(e.state.clickBusy, false)
  eq(#e.state.clickQueue, 0); eq(next(e.state.macroTimers), nil)
end)
test("a rapid second deferred click survives the first click exiting Grid", function()
  local e = fixture("neru"); e:emit(NATIVE)
  e.module.dispatch("confirm_left"); e.module.dispatch("confirm_left")
  e:tick(); e:reply({"neru", "action", "move_mouse", "--selection"}, true)
  e:emit(EXIT); e:tick(); eq(#e.pending, 1)
  e:reply(CLICK_EXIT, true)
  e:reply({"neru", "action", "move_mouse", "--x", "100", "--y", "200"}, true)
  e:reply(CLICK_EXIT, true); e:noPending()
end)
test("deferred non-grid click commands use sequence grammar not unsupported CLI flags", function()
  for _, button in ipairs({"left", "right", "middle"}) do
    local e = fixture("neru"); e:emit("bisect"); e.module.dispatch("confirm_" .. button)
    e:noPending(); e:tick()
    e:reply({"neru", "run", "--stop-on-error", "action " .. button .. "_click"}, true)
    e:reply({"neru", "idle"}, true); e:noPending()
  end
end)
test("a rejected click sequence does not execute post-click cleanup", function()
  local e = fixture("neru"); e:emit("bisect"); e.module.dispatch("confirm_left"); e:tick()
  e:reply({"neru", "run", "--stop-on-error", "action left_click"}, false); e:noPending()
end)
test("deferred macro work is discarded after a mode transition", function()
  local e = fixture("neru"); e:emit(NATIVE); e.module.dispatch("confirm_left")
  e:emit(VIM); e:tick(); e:noPending(); eq(next(e.state.macroTimers), nil)
end)
test("shutdown cancels pending macro IPC timers", function()
  local e = fixture("neru"); e:emit(NATIVE); e.module.dispatch("confirm_left")
  e.state.close(); local calls = #e.calls; e:tick(); eq(#e.calls, calls)
  eq(next(e.state.macroTimers), nil); e:noPending()
end)
test("unknown macro names and inactive profiles cannot enqueue arbitrary work", function()
  local e = fixture("neru"); e.module.dispatch("not_a_macro")
  eq(next(e.state.macroTimers), nil); eq(#e.timers, 0); e:noPending()
  e.state.busy = true; e.module.dispatch("confirm_left"); eq(#e.timers, 0)
  local fallback = fixture(); fallback.module.dispatch("confirm_left")
  eq(#fallback.timers, 0); fallback:noPending()
end)
test("rapid grid click keys queue and repeat at the original point after reset", function()
  local e = fixture("neru"); e:emit(NATIVE); e.state.continuous = true
  e.state.confirmClick("left", false); e.state.confirmClick("left", false); e.state.confirmClick("left", false)
  e:reply({"neru", "action", "move_mouse", "--selection"}, true)
  e:reply(CLICK_STAY, true)
  for _ = 1, 2 do
    e:reply({"neru", "action", "move_mouse", "--x", "100", "--y", "200"}, true)
    e:reply(CLICK_STAY, true)
  end
  e:noPending(); eq(e.state.clickBusy, false)
end)
local function movingRepeatFixture()
  local e = fixture("neru"); e:emit(NATIVE); e.state.continuous = true
  e.state.confirmClick("left", false)
  e:reply({"neru", "action", "move_mouse", "--selection"}, true); e:reply(CLICK_STAY, true)
  e.cursorPoint = {x = 10, y = 20}
  e.state.confirmClick("left", false)
  return e
end
test("repeat click waits for the actual cursor endpoint after the move acknowledgement", function()
  local e = movingRepeatFixture()
  e:reply({"neru", "action", "move_mouse", "--x", "100", "--y", "200"}, true)
  e:noPending(); eq(e.state.clickBusy, true); eq(e.module.status().waitingForCursor, true)
  e.cursorPoint = {x = 50, y = 100}; e:tick(); e:noPending()
  e.cursorPoint = {x = 100, y = 199.9}; e:tick(); e:noPending()
  e.cursorPoint = {x = 100, y = 200}; e:tick()
  e:reply(CLICK_STAY, true); e:noPending(); eq(e.state.clickBusy, false)
  eq(e.module.status().waitingForCursor, false)
end)
test("reaching the endpoint keeps a queued double click ordered", function()
  local e = movingRepeatFixture(); e.state.confirmClick("left", false)
  e:reply({"neru", "action", "move_mouse", "--x", "100", "--y", "200"}, true); e:noPending()
  e.cursorPoint = {x = 100, y = 200}; e:tick(); e:reply(CLICK_STAY, true)
  e:reply({"neru", "action", "move_mouse", "--x", "100", "--y", "200"}, true)
  e:reply(CLICK_STAY, true); e:noPending(); eq(#e.state.clickQueue, 0)
end)
test("cursor wait times out without clicking at a partial movement position", function()
  local e = movingRepeatFixture()
  e:reply({"neru", "action", "move_mouse", "--x", "100", "--y", "200"}, true)
  e.clock = 102; e:tick(); e:noPending(); eq(e.state.clickBusy, false)
  eq(#e.state.clickQueue, 0)
  assert(e.messages[#e.messages]:find("cursor did not reach target", 1, true))
end)
test("a mode change during cursor wait cannot produce a late click", function()
  local e = movingRepeatFixture()
  e:reply({"neru", "action", "move_mouse", "--x", "100", "--y", "200"}, true)
  e:emit(VIM); e.cursorPoint = {x = 100, y = 200}; e:tick(); e:noPending()
  eq(e.module.status().waitingForCursor, false)
end)
test("a new aiming generation cancels an old repeat wait", function()
  local e = movingRepeatFixture()
  e:reply({"neru", "action", "move_mouse", "--x", "100", "--y", "200"}, true)
  e.state.aimGeneration = e.state.aimGeneration + 1
  e.cursorPoint = {x = 100, y = 200}; e:tick(); e:noPending()
  eq(e.state.clickBusy, false); eq(#e.state.clickQueue, 0)
end)
test("a cancelled repeat move acknowledgement cannot leave the click queue blocked", function()
  local e = movingRepeatFixture(); e.state.aimGeneration = e.state.aimGeneration + 1
  e:reply({"neru", "action", "move_mouse", "--x", "100", "--y", "200"}, true)
  e:noPending(); eq(e.state.clickBusy, false); eq(e.state.cursorWaitTimer, nil)
end)
test("shutdown stops cursor wait without delivering its pending click", function()
  local e = movingRepeatFixture()
  e:reply({"neru", "action", "move_mouse", "--x", "100", "--y", "200"}, true)
  e.state.close(); local calls = #e.calls
  e.cursorPoint = {x = 100, y = 200}; e:tick(); eq(#e.calls, calls); e:noPending()
  eq(e.state.cursorWaitTimer, nil)
end)
test("repeat click coordinates serialize real NSPoint floats as integers", function()
  local e = fixture("neru"); e:emit(NATIVE); e.cursorPoint = {x=1210.0, y=780.0}
  e.state.confirmClick("left", false)
  e:reply({"neru", "action", "move_mouse", "--selection"}, true); e:emit(EXIT); e:reply(CLICK_EXIT, true)
  e.state.confirmClick("left", false)
  e:reply({"neru", "action", "move_mouse", "--x", "1210", "--y", "780"}, true)
  e:reply(CLICK_EXIT, true); e:noPending()
end)
test("typing a letter recovers a five-second peek immediately", function()
  local e=fixture("neru");e:emit(NATIVE);e.state.continuous=true
  e.state.confirmClick("left",false)
  e:reply({"neru","action","move_mouse","--selection"},true);e:reply(CLICK_STAY,true)
  e.state.inputHandler({getType=function()return 10 end,getKeyCode=function()return 13 end,getFlags=function()return {} end})
  argvEq(e.calls[#e.calls].args,{"neru","peek-grid","--duration","1ms","--opacity","1"})
  eq(e.state.gridPeekPending,false);e:noPending()
end)
test("typing before the peek step runs cannot leave a late dimmed grid", function()
  local e=fixture("neru");e:emit(NATIVE);e.state.continuous=true
  e.state.confirmClick("left",false);e:reply({"neru","action","move_mouse","--selection"},true)
  e.state.inputHandler({getType=function()return 10 end,getKeyCode=function()return 34 end,getFlags=function()return {} end})
  e:reply(CLICK_STAY,true)
  argvEq(e.calls[#e.calls].args,{"neru","peek-grid","--duration","1ms","--opacity","1"})
  eq(e.state.gridPeekPending,false);e:noPending()
end)
test("Enter repeats are captured briefly after exiting to idle", function()
  local e = fixture("neru"); e:emit(NATIVE); e.state.confirmClick("left", true)
  e:reply({"neru", "action", "move_mouse", "--selection"}, true); e:emit(EXIT)
  eq(e:bareKey("Enter"), true)
  e:reply(CLICK_EXIT, true)
  e:reply({"neru", "action", "move_mouse", "--x", "100", "--y", "200"}, true)
  e:reply(CLICK_EXIT, true)
  e.clock = 101; eq(e:bareKey("Enter"), false); e:noPending()
end)
test("a new aiming key invalidates the click repeat target", function()
  local e = fixture("neru"); e:emit(NATIVE); e.state.continuous = true; e.state.confirmClick("left", false)
  e:reply({"neru", "action", "move_mouse", "--selection"}, true); e:reply(CLICK_STAY, true)
  e.state.inputHandler({getType = function() return 10 end, getKeyCode = function() return 34 end, getFlags = function() return {} end})
  e.state.confirmClick("left", false)
  e:reply({"neru", "action", "move_mouse", "--selection"}, true); e:reply(CLICK_STAY, true); e:noPending()
end)
test("autorepeat cannot confirm a held fine-grid key", function()
  local e = fixture("neru"); e:emit(NATIVE)
  hs.eventtap.event.properties = {keyboardEventAutorepeat = 123}
  eq(e.state.inputHandler({getType = function() return 10 end, getKeyCode = function() return 34 end,
    getProperty = function() return 1 end}), true)
  e:noPending()
end)
test("Space exits instead of peeking when continuous is off", function()
  local e = fixture("neru"); e:emit(NATIVE); e.state.continuous = false
  e.state.confirmClick("left", false)
  e:reply({"neru", "action", "move_mouse", "--selection"}, true); e:reply(CLICK_EXIT, true); e:noPending()
end)
test("holding a fine key arms nudge keys; release never clicks", function()
  local e = fixture("neru"); e:emit(NATIVE)
  local function key(code, up)
    return e.state.inputHandler({getType = function() return up and 11 or 10 end, getKeyCode = function() return code end, getFlags = function() return {} end})
  end
  eq(key(32), false); eq(e.state.nudgeHoldTimer.delay, 0.2); e:tick()
  eq(e.state.nudgeActive, true)
  for code, direction in pairs({[13]="up",[40]="up",[34]="up",[1]="down",[38]="down",[0]="left",[4]="left",[2]="right",[37]="right"}) do
    eq(key(code), true)
    argvEq(e.calls[#e.calls].args, {"neru", "nudge-grid", "--direction", direction, "--nudges-per-cell", "16"})
  end
  eq(key(32, true), false); eq(e.state.nudgeActive, false)
  eq(key(38), false) -- another fine key selects normally after release
  e:noPending()
end)
test("two short fine taps confirm, but one tap only aims", function()
  local e = fixture("neru"); e:emit(NATIVE)
  local function tap(code, up)
    return e.state.inputHandler({getType=function() return up and 11 or 10 end, getKeyCode=function() return code end, getFlags=function() return {} end})
  end
  tap(34); tap(34,true); e:noPending()
  e.state.latestGridSelection={x=100,y=200}
  tap(34); tap(34,true)
  e:reply({"neru","action","move_mouse","--selection"},true)
  e:emit(EXIT); e:reply(CLICK_EXIT,true)
  eq(tap(34),true); eq(tap(34,true),true)
  e:reply({"neru","action","move_mouse","--x","100","--y","200"},true)
  e:reply(CLICK_EXIT,true); e:noPending()
end)
test("modifier repeat fine taps use the matching Space action", function()
  for _, case in ipairs({{flags={alt=true},button="right"},{flags={cmd=true},button="middle"}}) do
    local e=fixture("neru");e:emit(NATIVE);e.state.lastFineTapCode=34;e.state.latestGridSelection={x=100,y=200}
    e.state.inputHandler({getType=function()return 10 end,getKeyCode=function()return 34 end,getFlags=function()return case.flags end})
    eq(e.state.dragHeld,false)
    e.state.inputHandler({getType=function()return 11 end,getKeyCode=function()return 34 end})
    e:reply({"neru","action","move_mouse","--selection"},true)
    e:reply({"neru","run","--stop-on-error","action "..case.button.."_click --bare --bail-on-error","idle"},true);e:noPending()
  end
end)
test("modified first fine tap only selects and does not leak the shortcut", function()
  local e=fixture("neru");e:emit(NATIVE)
  eq(e.state.inputHandler({getType=function()return 10 end,getKeyCode=function()return 34 end,getFlags=function()return {cmd=true} end}),true)
  e:reply({"neru","action","feed","--mode","i"},true)
  eq(e.state.inputHandler({getType=function()return 11 end,getKeyCode=function()return 34 end}),true)
  e:noPending()
end)
test("modifier fine hold releases without clicking or starting a drag", function()
  local e=fixture("neru");e:emit(NATIVE);e.state.lastFineTapCode=34;e.state.latestGridSelection={x=100,y=200}
  e.state.inputHandler({getType=function()return 10 end,getKeyCode=function()return 34 end,getFlags=function()return {ctrl=true} end})
  e:tick()
  e.state.inputHandler({getType=function()return 11 end,getKeyCode=function()return 34 end})
  eq(e.state.dragLatched,false);eq(#e.mouse,0);e:noPending()
end)
test("Ctrl repeat fine tap starts a hold like Ctrl+Space", function()
  local e=fixture("neru");e:emit(NATIVE);e.state.lastFineTapCode=34;e.state.latestGridSelection={x=100,y=200}
  e.state.inputHandler({getType=function()return 10 end,getKeyCode=function()return 34 end,getFlags=function()return {ctrl=true} end})
  e.state.inputHandler({getType=function()return 11 end,getKeyCode=function()return 34 end})
  e:reply({"neru","action","move_mouse","--selection"},true);e:reply({"neru","run","action reset"},true)
  eq(e.state.dragLatched,true);eq(#e.mouse,1);e:noPending()
end)
test("Shift repeat fine tap moves only like Shift+Space", function()
  local e=fixture("neru");e:emit(NATIVE);e.state.lastFineTapCode=34;e.state.latestGridSelection={x=100,y=200}
  e.state.inputHandler({getType=function()return 10 end,getKeyCode=function()return 34 end,getFlags=function()return {shift=true} end})
  e.state.inputHandler({getType=function()return 11 end,getKeyCode=function()return 34 end})
  e:reply({"neru","action","move_mouse","--selection"},true);e:reply({"neru","run","action reset"},true)
  eq(#e.mouse,0);e:noPending()
end)
test("combined repeat modifiers defer to the configured Space chord", function()
  local e=fixture("neru");e:emit(NATIVE);e.state.lastFineTapCode=34;e.state.latestGridSelection={x=100,y=200}
  e.state.inputHandler({getType=function()return 10 end,getKeyCode=function()return 34 end,getFlags=function()return {ctrl=true,alt=true} end})
  e.state.inputHandler({getType=function()return 11 end,getKeyCode=function()return 34 end})
  e:reply({"neru","action","feed","--mode","Ctrl+Alt+Space"},true);e:noPending()
end)
test("repeating a destination fine key drops a Ctrl+Space drag without an extra click", function()
  local e=fixture("neru");e:emit(NATIVE);e.module.startHold()
  e:reply({"neru","action","move_mouse","--selection"},true);e:reply({"neru","run","action reset"},true)
  local function key(up) return e.state.inputHandler({getType=function()return up and 11 or 10 end,getKeyCode=function()return 34 end,getFlags=function()return {} end}) end
  key(false);key(true);e.state.latestGridSelection={x=900,y=700}
  key(false);key(true)
  e:reply({"neru","action","move_mouse","--selection"},true);e:reply({"neru","idle"},true)
  eq(e.state.dragLatched,false);eq(#e.mouse,2);eq(e.mouse[1].kind,1);eq(e.mouse[2].kind,2);e:noPending()
end)
test("holding an already selected fine key never confirms on release", function()
  local e=fixture("neru");e:emit(NATIVE)
  local function event(up) return {getType=function() return up and 11 or 10 end,getKeyCode=function() return 34 end,getFlags=function() return {} end} end
  e.state.lastFineTapCode=34;e.state.latestGridSelection={x=100,y=200}
  e.state.inputHandler(event(false));e:tick();e.state.inputHandler(event(true));e:noPending()
end)
test("holding a pregrid key initializes the selected rectangle center", function()
  local e = fixture("neru"); e:emit(NATIVE)
  e.state.inputHandler({getType = function() return 10 end, getKeyCode = function() return 2 end, getFlags = function() return {} end})
  e:tick()
  argvEq(e.calls[#e.calls].args, {"neru", "nudge-grid", "--direction", "up", "--nudges-per-cell", "16", "--count", "0"})
  e:noPending()
end)
test("continuous Hints refresh after 500ms, not immediately", function()
  local e = fixture("neru"); e:emit(HINTS); e.state.continuous = true
  e.state.afterClick("stay"); e.state.afterClick("stay")
  eq(e.state.hintRefreshTimer.delay, 0.5); e:noPending()
  e:tick(); e:noPending(); e:tick()
  e:reply({"neru", "action", "refresh_hints", "--if-input-empty"}, true); e:noPending()
end)
test("leaving Hints cancels the delayed refresh", function()
  local e = fixture("neru"); e:emit(HINTS); e.state.continuous = true; e.state.afterClick("stay")
  e:emit(EXIT); e:tick(); e:noPending()
end)
test("Hints exit is recalled once and repeated Right Shift regresses to Grid then Idle", function()
  local e = fixture("neru"); e:key("F16", "cmd")
  e:reply({"neru", "hints", "--strategy", "axtree", "--action", "left_click"}, true)
  e:emit(HINTS); e:emit(EXIT); e:key("F16")
  e:reply({"neru", "hints", "--strategy", "axtree", "--action", "left_click"}, true)
  e:emit(HINTS); e:key("F16")
  e:reply({"neru", "grid", "--cursor-selection-mode", "hold"}, true)
  e:emit(NATIVE); eq(e.store["neruNavigation.lastPointerMode"], "grid"); e:key("F16")
  e:reply({"neru", "idle"}, true); e:emit(EXIT); e:key("F16")
  e:reply({"neru", "grid", "--cursor-selection-mode", "hold"}, true); e:noPending()
end)
test("Option+Shift+F16 opens Grid directly from every mode without toggling idle", function()
  for _, mode in ipairs({EXIT, HINTS, GRID, NATIVE, SCROLL, VIM}) do
    local e = fixture("neru"); e:emit(mode); e:key("F16", {"alt", "shift"})
    e:reply({"neru", "grid", "--cursor-selection-mode", "hold"}, true); e:noPending()
  end
  local e = fixture(); e:key("F16", {"alt", "shift"}); e:noPending()
end)
test("Right Shift from Vim goes to Grid rather than restoring Hints", function()
  local e = fixture("neru"); e:emit(VIM); e:key("F16")
  e:reply({"neru", "grid", "--cursor-selection-mode", "hold"}, true); e:noPending()
end)
test("Left Shift plus Right Shift opens Grid directly from every mode", function()
  for _, mode in ipairs({EXIT, HINTS, GRID, NATIVE, SCROLL, VIM}) do
    local e = fixture("neru"); e:emit(mode); e:key("F16", "shift")
    e:reply({"neru", "grid", "--cursor-selection-mode", "hold"}, true); e:noPending()
  end
  local e = fixture(); e:key("F16", "shift"); e:noPending()
end)
test("Right Shift restores the remembered pointer mode only from Idle", function()
  for _, last in ipairs({"grid", "hints"}) do
    for _, mode in ipairs({EXIT, HINTS, GRID, VIM, SCROLL, "bisect", "monitor"}) do
      local e = fixture("neru", {["neruNavigation.lastPointerMode"] = last})
      e:emit(mode); e:key("F16")
      if mode == EXIT and last == "hints" then
        e:reply({"neru", "hints", "--strategy", "axtree", "--action", "left_click"}, true)
      else e:reply({"neru", "grid", "--cursor-selection-mode", "hold"}, true) end
      e:noPending()
    end
  end
end)
test("last pointer mode survives a new Hammerspoon session", function()
  local store = {}
  local e = fixture("neru", store); e:emit(NATIVE); e:emit(EXIT)
  local nextSession = fixture("neru", store); nextSession:key("F16")
  nextSession:reply({"neru", "grid", "--cursor-selection-mode", "hold"}, true)
end)
test("direct launchers and snapshots update the remembered pointer mode", function()
  local e = fixture("neru"); e:emit("grid_snapshot")
  eq(e.state.lastPointerMode, "grid"); e:emit(GRID); e:emit(VIM)
  eq(e.state.lastPointerMode, "grid"); e:emit("hint_snapshot")
  eq(e.store["neruNavigation.lastPointerMode"], "hints")
end)
test("failed switch does not remember a mode that never opened", function()
  local e = fixture("neru"); e:emit(HINTS); e:key("F16")
  e:reply({"neru", "grid", "--cursor-selection-mode", "hold"}, false)
  eq(e.state.lastPointerMode, "hints"); eq(e.store["neruNavigation.lastPointerMode"], "hints")
end)
test("invalid saved pointer mode defaults to Grid and inactive profiles stay disarmed", function()
  local e = fixture("neru", {["neruNavigation.lastPointerMode"] = "vim"})
  eq(e.state.lastPointerMode, "grid")
  local fallback = fixture(); fallback.module.rightShift(); fallback:noPending()
end)
test("config watcher is stopped on shutdown", function()
  local e = fixture("neru"); e.state.close(); eq(e.configWatcherStopped, true)
end)

test("watch waits for asynchronous PATH readiness", function()
  local e = fixture("neru", {deferPath = true})
  eq(#e.watchers, 0); eq(e.state.watch, nil)
  e.pathWaiters[1](true); eq(#e.watchers, 1); assert(e.state.watch)
end)
test("late PATH readiness cannot revive a closed watch", function()
  local e = fixture("neru", {deferPath = true})
  e.state.close(); e.pathWaiters[1](true); eq(#e.watchers, 0)
end)
test("failed PATH readiness does not start a watch", function()
  local e = fixture("neru", {deferPath = true})
  e.pathWaiters[1](false); eq(#e.watchers, 0); eq(e.state.watch, nil)
end)

local failures = 0
for _, t in ipairs(tests) do
  local ok, err = xpcall(t[2], debug.traceback)
  if ok then print("PASS " .. t[1]) else failures = failures + 1; io.stderr:write("FAIL " .. t[1] .. "\n" .. err .. "\n") end
end
print(#tests .. " tests, " .. failures .. " failures")
if failures > 0 then os.exit(1) end
