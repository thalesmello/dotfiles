local a = require("async")
local util = require("util")

local M = {}

local FISH = "/opt/homebrew/bin/fish"
M.FISH = FISH

-- Fetch PATH from fish once at startup
_G._PathDirs = {"/usr/bin/", "/opt/homebrew/bin/"}
do
  local output = hs.execute(FISH .. " -lc 'printf \"%s\\n\" $PATH'")
  if output then
    for dir in output:gmatch("[^\n]+") do
      _PathDirs[#_PathDirs + 1] = dir
    end
  end
end

-- Capture inherited environment and augment PATH so #!/usr/bin/env finds fish etc.
_G._TaskEnv = {}
do
  local _taskEnv = _G._TaskEnv
  local envOutput = hs.execute("/usr/bin/env")
  if envOutput then
    for line in envOutput:gmatch("[^\n]+") do
      local k, v = line:match("^([^=]+)=(.*)")
      if k then _taskEnv[k] = v end
    end
  end
  _taskEnv.PATH = table.concat(_PathDirs, ":")
  -- pbpaste and other CLIs pick their text encoding from the locale; Hammerspoon's
  -- GUI environment has none, so default to UTF-8 (else pbpaste emits Mac Roman).
  _taskEnv.LANG = _taskEnv.LANG or "en_US.UTF-8"
  _taskEnv.LC_CTYPE = _taskEnv.LC_CTYPE or "en_US.UTF-8"
end

-- Memoized binary resolution
local _resolvedPaths = {}
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

-- Prevent hs.task objects from being garbage-collected before their callback fires
_G._RunningTasks = {}

-- Fire-and-forget direct binary execution
function M.task(args, callback)
  local resolvedPath = M.resolvePath(args[1])
  if not resolvedPath then if callback then callback(false, "") end; return end
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
    if stdOut and #stdOut > 0 then util.log("task stdout:", stdOut) end
    if stdErr and #stdErr > 0 then util.log("task stderr:", stdErr) end
    if callback then callback(exitCode == 0, (stdOut or ""):gsub("%s+$", "")) end
  end, taskArgs)
  t:setEnvironment(_TaskEnv)

  _RunningTasks[t] = true
  t:start()
end

M.taskAsync = a.wrap(M.task)

function M.fish(cmd, callback)
  M.task({FISH, "-c", cmd}, callback)
end

M.fishAsync = a.wrap(M.fish)

M.sleepAsync = a.wrap(function(seconds, callback)
  hs.timer.doAfter(seconds, function() callback() end)
end)

return M
