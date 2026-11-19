local a = require("async")
local util = require("util")

local M = {}

local FISH = "/opt/homebrew/bin/fish"
M.FISH = FISH

-- Read the inherited environment in-process; no /usr/bin/env subprocess.
-- A task that has not started exposes the environment it would inherit.
local environmentProbe = hs.task.new("/usr/bin/true", nil, {})
_G._TaskEnv = environmentProbe:environment()
_TaskEnv.LANG = _TaskEnv.LANG or "en_US.UTF-8"
_TaskEnv.LC_CTYPE = _TaskEnv.LC_CTYPE or "en_US.UTF-8"
_G._RunningTasks = {}

-- Synchronous lookups may use the last known PATH. Actual tasks ALWAYS wait
-- for fresh Fish discovery, so changed local PATH configuration is respected.
_G._PathDirs = {"/usr/bin/", "/opt/homebrew/bin/"}
local cached = hs.settings.get("shell.pathDirs")
for _, dir in ipairs(type(cached) == "table" and cached or {}) do
  if type(dir) == "string" then _PathDirs[#_PathDirs + 1] = dir end
end
for dir in (_TaskEnv.PATH or ""):gmatch("[^:]+") do
  _PathDirs[#_PathDirs + 1] = dir
end
_TaskEnv.PATH = table.concat(_PathDirs, ":")

local ready, discovery, timeout = false, nil, nil
local waiters = {}
local _resolvedPaths = {}
function M.whenReady(callback)
  if ready then callback(true); return end
  waiters[#waiters + 1] = callback
  if discovery then return end
  local finished = false
  local function finish(ok, output)
    if finished then return end
    finished = true
    if timeout then timeout:stop(); timeout = nil end
    if discovery then _RunningTasks[discovery] = nil end
    discovery = nil
    if ok and output and output:find("/", 1, true) then
      _G._PathDirs = {"/usr/bin/", "/opt/homebrew/bin/"}
      for dir in output:gmatch("[^\n]+") do _PathDirs[#_PathDirs + 1] = dir end
      _TaskEnv.PATH = table.concat(_PathDirs, ":")
      _resolvedPaths = {}
      hs.settings.set("shell.pathDirs", _PathDirs)
      ready = true
    else
      util.log("shell: Fish PATH discovery failed; dependent tasks were not started")
    end
    local pending = waiters
    waiters = {}
    for _, fn in ipairs(pending) do
      local success, err = pcall(fn, ready)
      if not success then util.log("shell: readiness callback failed:", err) end
    end
  end
  discovery = hs.task.new(FISH, function(code, out) finish(code == 0, out) end,
    {"-lc", 'printf "%s\n" $PATH'})
  if not discovery then finish(false); return end
  _RunningTasks[discovery] = true
  timeout = hs.timer.doAfter(10, function()
    local task = discovery
    finish(false)
    if task then task:terminate() end
  end)
  if not discovery:start() then finish(false) end
end

-- Memoized binary resolution
function M.resolvePath(binaryName)
  if _resolvedPaths[binaryName] then return _resolvedPaths[binaryName] end
  if binaryName:sub(1, 1) == "/" then
    _resolvedPaths[binaryName] = binaryName
    return binaryName
  end
  for _, dir in ipairs(_PathDirs) do
    local fullPath = dir .. "/" .. binaryName
    if hs.fs.attributes(fullPath, "mode") then
      _resolvedPaths[binaryName] = fullPath
      return fullPath
    end
  end
  util.log("resolvePath: not found:", binaryName)
  return nil
end

-- _RunningTasks retains both discovery and ordinary tasks until completion.

-- Fire-and-forget direct binary execution.
--
-- `args` is the argv array, optionally carrying named options alongside it (the
-- hash part is invisible to table.unpack/ipairs, so it never reaches the
-- binary):
--   print_stdout = false  -- don't debug-log this task's stdout
-- Use it for commands whose output is large and uninteresting -- e.g.
-- `yabai -m query --windows` is ~11KB of JSON that would otherwise land in the
-- console on every keypress. The trace line and stderr are still logged.
local function startTask(args, callback)
  local resolvedPath = M.resolvePath(args[1])
  if not resolvedPath then if callback then callback(false, "") end; return end
  local printStdout = args.print_stdout ~= false
  local taskArgs = {table.unpack(args, 2)}
  local quotedPath = resolvedPath:find("%s") and string.format("%q", resolvedPath) or resolvedPath
  local quotedArgs = {}
  for i, arg in ipairs(taskArgs) do
    quotedArgs[i] = arg:find("%s") and string.format("%q", arg) or arg
  end
  util.log("task:", quotedPath, table.unpack(quotedArgs))
  local t
  t = hs.task.new(resolvedPath, function(exitCode, stdOut, stdErr)
    _RunningTasks[t] = nil
    if stdOut and #stdOut > 0 and printStdout then util.log("task stdout:", stdOut) end
    if stdErr and #stdErr > 0 then util.log("task stderr:", stdErr) end
    if callback then callback(exitCode == 0, (stdOut or ""):gsub("%s+$", "")) end
  end, taskArgs)
  if not t then if callback then callback(false, "") end; return end
  t:setEnvironment(_TaskEnv)

  _RunningTasks[t] = true
  if not t:start() then
    _RunningTasks[t] = nil
    if callback then callback(false, "") end
    return
  end
  -- Callers with cancellable background work can retain and terminate it.
  return t
end

function M.task(args, callback)
  if ready then return startTask(args, callback) end
  -- Preserve cancellation even when PATH discovery has not completed yet.
  local handle = {cancelled = false}
  function handle:terminate()
    self.cancelled = true
    if self.task then self.task:terminate() end
    return self
  end
  M.whenReady(function(ok)
    if handle.cancelled then return end
    if ok then handle.task = startTask(args, callback)
    elseif callback then callback(false, "") end
  end)
  return handle
end

M.taskAsync = a.wrap(M.task)

-- Run several direct binary tasks concurrently. Callback receives the number of
-- successful tasks and the per-task callback results ({ok, stdout}) in input
-- order.
function M.taskAll(argsList, callback)
  local remaining = #argsList
  local results = {}
  local okCount = 0

  if remaining == 0 then
    if callback then callback(0, results) end
    return
  end

  for i, args in ipairs(argsList) do
    M.task(args, function(ok, out)
      results[i] = {ok, out}
      if ok then okCount = okCount + 1 end
      remaining = remaining - 1
      if remaining == 0 and callback then callback(okCount, results) end
    end)
  end
end

M.taskAllAsync = a.wrap(M.taskAll)

function M.fish(cmd, callback)
  return M.task({FISH, "-c", cmd}, callback)
end

M.fishAsync = a.wrap(M.fish)

M.sleepAsync = a.wrap(function(seconds, callback)
  hs.timer.doAfter(seconds, function() callback() end)
end)

return M
