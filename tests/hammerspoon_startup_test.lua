-- Offline tests: no GUI, IPC, real tasks, or clipboard modifications.
local ROOT = "stow_modules/main/dot-hammerspoon/"
local count = 0
local function eq(a, b) assert(a == b, tostring(a) .. " ~= " .. tostring(b)) end
local function test(name, fn) fn(); count = count + 1; print("PASS " .. name) end
local function timers(e)
  return {doAfter = function(delay, fn)
    local t = {delay = delay}
    function t:stop() self.stopped = true end
    function t:fire() if not self.stopped then fn() end end
    e.timers[#e.timers + 1] = t
    return t
  end}
end
local function shellFixture()
  local e = {tasks = {}, timers = {}, settings = {}}
  package.loaded.async = {wrap = function(fn) return fn end}
  package.loaded.util = {log = function() end}
  hs = {
    execute = function() error("blocking shell execution") end,
    timer = timers(e),
    settings = {get = function(k) return e.settings[k] end, set = function(k,v) e.settings[k] = v end},
    fs = {attributes = function(path) return path == "/fresh/tool" and "file" or nil end},
    task = {new = function(path, cb, args)
      local t = {path = path, cb = cb, args = args}
      function t:environment() return {PATH = "/inherited", TOKEN = "preserved"} end
      function t:setEnvironment(env) self.env = env end
      function t:start() self.started = true; return not e.startFails and self or false end
      function t:terminate() self.terminated = true end
      e.tasks[#e.tasks + 1] = t
      return t
    end},
  }
  e.mod = dofile(ROOT .. "shell.lua")
  return e
end
test("shell module starts no subprocess", function()
  local e = shellFixture(); eq(#e.tasks, 1); eq(e.tasks[1].started, nil)
  eq(_TaskEnv.TOKEN, "preserved"); eq(_TaskEnv.LANG, "en_US.UTF-8")
end)
test("tasks queue behind one fresh Fish discovery", function()
  local e = shellFixture(); local results = {}
  e.mod.task({"tool"}, function(ok, out) results[#results + 1] = {ok, out} end)
  e.mod.task({"/absolute"})
  eq(#e.tasks, 2); eq(e.tasks[2].path, "/opt/homebrew/bin/fish")
  e.tasks[2].cb(0, "/fresh\n", "")
  eq(#e.tasks, 4); eq(e.tasks[3].path, "/fresh/tool")
  eq(e.tasks[3].env.TOKEN, "preserved")
  assert(e.tasks[3].env.PATH:find("/fresh", 1, true))
  e.tasks[3].cb(0, "result\n", ""); eq(results[1][2], "result")
  assert(e.settings["shell.pathDirs"])
  eq(e.timers[1].stopped, true)
end)
test("queued cancellation prevents launch", function()
  local e = shellFixture(); local h = e.mod.task({"tool"}, function() error("cancelled callback") end)
  h:terminate(); e.tasks[2].cb(0, "/fresh\n", ""); eq(#e.tasks, 2)
end)
test("queued handle can terminate task after discovery", function()
  local e = shellFixture(); local h = e.mod.task({"tool"})
  e.tasks[2].cb(0, "/fresh\n", ""); h:terminate(); eq(e.tasks[3].terminated, true)
end)
test("failed discovery fails callbacks and allows retry", function()
  local e = shellFixture(); local result
  e.mod.task({"tool"}, function(ok) result = ok end)
  e.tasks[2].cb(1, "", "failed"); eq(result, false); eq(#e.tasks, 2)
  e.mod.task({"tool"}); eq(#e.tasks, 3)
  e.tasks[3].cb(0, "/fresh\n", ""); eq(#e.tasks, 4)
end)
test("discovery timeout cancels process and ignores late reply", function()
  local e = shellFixture(); local callbacks = 0
  e.mod.task({"tool"}, function(ok) eq(ok, false); callbacks = callbacks + 1 end)
  e.timers[1]:fire(); eq(e.tasks[2].terminated, true)
  e.tasks[2].cb(0, "/fresh\n", ""); eq(callbacks, 1); eq(#e.tasks, 2)
end)
test("task start failure invokes callback without leaking retention", function()
  local e = shellFixture(); e.mod.whenReady(function() end)
  e.tasks[2].cb(0, "/fresh\n", ""); e.startFails = true
  local result; e.mod.task({"tool"}, function(ok) result = ok end)
  eq(result, false); eq(next(_RunningTasks), nil)
end)
test("readiness callback errors do not starve later tasks", function()
  local e = shellFixture(); e.mod.whenReady(function() error("bad waiter") end)
  e.mod.task({"tool"}); e.tasks[2].cb(0, "/fresh\n", ""); eq(#e.tasks, 3)
end)

local function downloadsFixture()
  local e = {timers = {}, files = {old = {mode = "file", creation = 10, size = 1}}, copied = {}, stats = 0}
  _G.DownloadWatcher, _G.DownloadWatcherBootstrap = nil, nil
  package.loaded.shell = {task = function(args, done) e.copied[#e.copied+1] = args[2]; done(true) end}
  package.loaded.preset = {displayMessage = function() end}
  hs = {timer = timers(e), fs = {
    pathToAbsolute = function() return "/downloads" end,
    dir = function()
      local names = {}; for name in pairs(e.files) do names[#names+1] = name end
      local i = 0; return function() i=i+1; return names[i] end
    end,
    attributes = function(path) e.stats=e.stats+1; return e.files[path:match("[^/]+$")] end,
  }, pathwatcher = {new = function(_, fn)
    local w = {callback = fn}; function w:start() self.started = true end
    function w:stop() self.stopped = true end; e.watcher = w; return w
  end}}
  e.mod = dofile(ROOT .. "downloadwatcher.lua"); e.mod.setup(); return e
end
test("Downloads metadata scan is deferred, listener is immediate", function()
  local e = downloadsFixture(); eq(e.stats, 0); eq(e.watcher.started, true)
  e.timers[1]:fire(); eq(e.stats, 1); eq(#e.copied, 0)
end)
test("download arriving before baseline is not swallowed", function()
  local e = downloadsFixture(); e.files.new = {mode = "file", creation = 20, size = 1}
  e.watcher.callback(); e.watcher.callback(); eq(e.stats, 0)
  e.timers[1]:fire(); eq(#e.copied, 1); eq(e.copied[1], "/downloads/new")
  e.watcher.callback(); eq(#e.copied, 1)
end)
test("partial downloads are ignored until final rename", function()
  local e = downloadsFixture(); e.timers[1]:fire()
  e.files["new.crdownload"] = {mode="file", creation=20, size=1}
  e.watcher.callback(); eq(#e.copied, 0)
  e.files.new = e.files["new.crdownload"]; e.files["new.crdownload"] = nil
  e.watcher.callback(); eq(#e.copied, 1)
end)
test("Downloads setup cancels previous bootstrap and watcher", function()
  local e = downloadsFixture(); local old = e.watcher; e.mod.setup()
  eq(old.stopped, true); eq(e.timers[1].stopped, true)
  e.timers[1]:fire(); eq(e.stats, 0); e.timers[2]:fire(); eq(e.stats, 1)
end)

local function appFixture(kind)
  local e = {timers = {}, sweeps = 0, attachments = 0, listeners = {}}
  _G.ZoomWatcher, _G.TotWatcher = nil, nil
  package.loaded.ghosttyPreset = {revealFloatingTerminal = function() end}
  local function watcher(fn)
    local w = {callback = fn}; function w:start() self.started = true end
    function w:stop() self.stopped = true end; function w:pid() return 1 end; return w
  end
  local app = {}
  function app:pid() return 1 end
  function app:name() return kind == "zoomwatcher" and "Zoom" or "Tot" end
  function app:bundleID() return kind == "zoomwatcher" and "us.zoom.xos" or "com.iconfactory.Tot" end
  function app:allWindows() e.sweeps=e.sweeps+1; return {} end
  function app:newWatcher(fn) e.attachments=e.attachments+1; return watcher(fn) end
  function app:isHidden() return true end
  local events = {launched=1, terminated=2, activated=3, unhidden=4, deactivated=5, hidden=6}
  hs = {timer=timers(e),
    application={applicationsForBundleID=function() return e.absent and {} or {app} end,
      frontmostApplication=function() return nil end, watcher=setmetatable({new=function(fn)
        local w=watcher(fn); e.listeners[#e.listeners+1]=w; return w
      end}, {__index=events})},
    window={focusedWindow=function() return nil end},
    axuielement={applicationElement=function() return nil end},
    uielement={watcher={}}, spaces={watcher={new=watcher}},
  }
  e.app=app; e.events=events; e.mod=dofile(ROOT .. kind .. ".lua"); e.mod.setup(); return e
end
for _, kind in ipairs({"zoomwatcher", "totwatcher"}) do
  test(kind .. " defers AX but listens immediately", function()
    local e=appFixture(kind); eq(e.sweeps, 0); eq(e.attachments, 0); eq(e.listeners[1].started, true)
    e.timers[1]:fire(); eq(e.attachments, 1); assert(e.sweeps > 0)
  end)
  test(kind .. " launch before bootstrap attaches exactly once", function()
    local e=appFixture(kind); e.listeners[1].callback(nil, e.events.launched, e.app)
    eq(e.attachments, 1); e.timers[1]:fire(); eq(e.attachments, 1)
  end)
  test(kind .. " absent app causes no AX calls", function()
    local e=appFixture(kind); e.absent=true; e.timers[1]:fire(); eq(e.attachments, 0); eq(e.sweeps, 0)
  end)
  test(kind .. " reload cancels old bootstrap", function()
    local e=appFixture(kind); e.mod.setup(); eq(e.timers[1].stopped, true)
    e.timers[1]:fire(); eq(e.attachments, 0); e.timers[2]:fire(); eq(e.attachments, 1)
  end)
end
print(count .. " startup tests passed")
