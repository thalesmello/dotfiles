-- Offline mocks only: no subprocesses, desktop changes or real file writes.
local ROOT = "stow_modules/main/dot-hammerspoon/"
local count = 0
local function eq(a, b) assert(a == b, tostring(a) .. " ~= " .. tostring(b)) end
local function test(name, fn) fn(); count = count + 1; print("PASS " .. name) end
local function fixture()
  local e = {content = "initial", watchers = {}, timers = {}, tasks = {}, alerts = {}}
  local realOpen = io.open
  e.path = os.getenv("HOME") .. "/.config/karabiner.edn"
  e.target = "/dotfiles/dot-config/karabiner.edn"
  hs = {
    fs = {pathToAbsolute = function(path) eq(path, e.path); return e.target end},
    pathwatcher = {new = function(path, fn)
      local w = {path = path, callback = fn}
      function w:start() self.started = true end
      function w:stop() self.stopped = true end
      e.watchers[#e.watchers + 1] = w; return w
    end},
    timer = {doAfter = function(delay, fn)
      eq(delay, 0.25)
      local t = {fn = fn}; function t:stop() self.stopped = true end
      function t:fire() if not self.stopped then fn() end end
      e.timers[#e.timers + 1] = t; return t
    end},
    alert = {show = function(message) e.alerts[#e.alerts + 1] = message end},
  }
  package.loaded.util = {log = function() end}
  package.loaded.shell = {task = function(args, done)
    eq(args[1], "goku"); eq(args[2], "-c"); eq(args[3], e.path)
    local t = {done = done}; function t:terminate() self.terminated = true end
    e.tasks[#e.tasks + 1] = t
    if e.failStart then done(false) end
    return t
  end}
  function e:withFile(fn)
    io.open = function(path)
      eq(path, self.path)
      if self.content == nil then return nil end
      return {read = function() return self.content end, close = function() end}
    end
    local ok, err = pcall(fn); io.open = realOpen; if not ok then error(err) end
  end
  e.mod = dofile(ROOT .. "gokuWatcher.lua")
  function e:setup() self:withFile(function() self.state = self.mod.setup() end) end
  function e:event(path) self.watchers[1].callback({path or self.target}) end
  function e:tick() self:withFile(function() self.timers[#self.timers]:fire() end) end
  function e:reply(ok) self.tasks[#self.tasks].done(ok) end
  e:setup(); return e
end

test("startup watches both symlink and target parents without compiling", function()
  local e = fixture(); eq(#e.watchers, 2); eq(#e.tasks, 0)
  eq(e.watchers[1].path, os.getenv("HOME") .. "/.config")
  eq(e.watchers[2].path, "/dotfiles/dot-config")
  eq(e.watchers[1].started, true); eq(e.watchers[2].started, true)
end)
test("burst saves debounce into one compile", function()
  local e = fixture(); e.content = "edit"; e:event(); local first = e.timers[1]
  e:event(); eq(first.stopped, true); e:tick(); eq(#e.tasks, 1)
end)
test("touching unchanged content does not compile", function()
  local e = fixture(); e:event(); e:tick(); eq(#e.tasks, 0)
end)
test("temporary and generated JSON files are ignored", function()
  local e = fixture(); e.content = "edit"
  e:event("/dotfiles/dot-config/karabiner.edn.tmp")
  e:event("/dotfiles/dot-config/karabiner/karabiner.json")
  eq(#e.timers, 0); eq(#e.tasks, 0)
end)
test("atomic replacement through the symlink path compiles", function()
  local e = fixture(); e.content = nil; e:event(e.path); e:tick(); eq(#e.tasks, 0)
  e.content = "replacement"; e:event(e.path); e:tick(); eq(#e.tasks, 1)
end)
test("a target-parent rename event compiles", function()
  local e = fixture(); e.content = "replacement"
  e:event("/dotfiles/dot-config"); e:tick(); eq(#e.tasks, 1)
end)
test("successful compilation suppresses duplicate content", function()
  local e = fixture(); e.content = "edit"; e:event(); e:tick(); e:reply(true)
  e:event(); e:tick(); eq(#e.tasks, 1); eq(#e.alerts, 0)
end)
test("save during compile queues a serial follow-up", function()
  local e = fixture(); e.content = "edit"; e:event(); e:tick()
  e.content = "newer"; e:event(); e:tick(); eq(#e.tasks, 1)
  e:reply(true); e:tick(); eq(#e.tasks, 2)
end)
test("pending unchanged content does not run a second compile", function()
  local e = fixture(); e.content = "edit"; e:event(); e:tick()
  e:event(); e:tick(); e:reply(true); e:tick(); eq(#e.tasks, 1)
end)
test("failure alerts and allows the same saved content to retry", function()
  local e = fixture(); e.content = "bad"; e:event(); e:tick(); e:reply(false)
  eq(#e.alerts, 1); e:event(); e:tick(); eq(#e.tasks, 2)
end)
test("synchronous startup failure does not retain a stale task", function()
  local e = fixture(); e.failStart = true; e.content = "edit"; e:event(); e:tick()
  eq(e.state.running, false); eq(e.state.task, nil); eq(#e.alerts, 1)
end)
test("stop cancels timers and tasks and ignores late callbacks", function()
  local e = fixture(); e.content = "edit"; e:event(); e:tick(); local task = e.tasks[1]
  e:event(); local timer = e.timers[#e.timers]; e.state.stop()
  eq(task.terminated, true); eq(timer.stopped, true)
  eq(e.watchers[1].stopped, true); eq(e.watchers[2].stopped, true)
  task.done(false); e:event(); timer.fn(); eq(#e.tasks, 1); eq(#e.alerts, 0)
end)
test("repeated setup stops the previous instance", function()
  local e = fixture(); local old = e.state; e:event(); e:setup()
  eq(old.closed, true); eq(e.watchers[1].stopped, true); eq(e.timers[1].stopped, true)
end)
print(count .. " Goku watcher tests passed")
