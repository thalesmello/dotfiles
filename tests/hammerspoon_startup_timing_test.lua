local path = "stow_modules/main/dot-hammerspoon/startupTiming.lua"
local KEY = "hammerspoon.reloadRequestedAt"
local count = 0
local function eq(a,b) assert(a == b, tostring(a) .. " ~= " .. tostring(b)) end
local function test(name, fn) fn(); count=count+1; print("PASS " .. name) end
local function fixture(requested)
  local e = {ms = 100, store = {[KEY] = requested}, reloads = 0}
  hs = {
    reload = function(arg) e.reloads=e.reloads+1; return "reloaded", arg end,
    settings = {
      get = function(key) return e.store[key] end,
      set = function(key,value) e.store[key]=value end,
      clear = function(key) e.store[key]=nil end,
    },
    timer = {
      absoluteTime = function() return e.ms * 1e6 end,
      doAfter = function(delay, fn) eq(delay,0); e.callback=fn; return {retained=true} end,
    },
  }
  e.mod=dofile(path)
  return e
end
test("untracked startup does not claim a full reload duration",function()
  local e=fixture(); local s=e.mod.begin(100e6)
  eq(s.beforeInitMs,nil); e.ms=130; e.mod.finish(s,100e6)
  eq(s.initMs,30); assert(s.timer.retained)
  e.ms=140; e.callback(); eq(s.firstEventLoopMs,40); eq(s.totalReloadMs,nil); eq(s.timer,nil)
end)
test("full reload includes time before init and deferred work",function()
  local e=fixture(20); local s=e.mod.begin(100e6)
  eq(s.beforeInitMs,80); eq(e.store[KEY],nil)
  e.ms=130; e.mod.finish(s,100e6); e.ms=140; e.callback()
  eq(s.initMs,30); eq(s.firstEventLoopMs,40); eq(s.totalReloadMs,120)
end)
test("reload wrapper timestamps and preserves return values",function()
  local e=fixture(); e.mod.begin(100e6); e.ms=200
  local a,b=hs.reload("argument")
  eq(a,"reloaded"); eq(b,"argument"); eq(e.reloads,1); eq(e.store[KEY],200)
end)
test("stale reload request is discarded",function()
  local e=fixture(-20000); local s=e.mod.begin(100e6)
  eq(s.beforeInitMs,nil); eq(e.store[KEY],nil)
end)
test("future reload request is discarded",function()
  local e=fixture(200); local s=e.mod.begin(100e6); eq(s.beforeInitMs,nil)
end)
test("non-numeric reload request is discarded",function()
  local e=fixture("invalid"); local s=e.mod.begin(100e6); eq(s.beforeInitMs,nil); eq(e.store[KEY],nil)
end)
print(count .. " startup timing tests passed")
