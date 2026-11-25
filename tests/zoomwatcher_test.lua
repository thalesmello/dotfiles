-- Offline countdown tests: no real windows or Zoom process.
local ROOT = "stow_modules/main/dot-hammerspoon/"
local count = 0
local function eq(a, b) assert(a == b, tostring(a) .. " ~= " .. tostring(b)) end
local function fixture()
  local e = {now = 0, timers = {}, views = {}, keys = {}, meeting = true, kills = 0}
  _G.ZoomWatcher = nil
  package.loaded.util = {log = function() end}
  local function watcher(callback)
    local w = {callback = callback}
    function w:start() return self end
    function w:stop() self.stopped = true end
    function w:pid() return 1 end
    return w
  end
  local win = {id = function() return 10 end, title = function() return "Zoom Meeting" end,
    newWatcher = function(_, callback) return watcher(callback) end}
  local app = {pid = function() return e.pid or 1 end, name = function() return "Zoom" end,
    bundleID = function() return "us.zoom.xos" end,
    allWindows = function() return e.meeting and {win} or {} end,
    newWatcher = function(_, callback) e.ax = watcher(callback); return e.ax end,
    kill = function() e.kills = e.kills + 1 end,
    kill9 = function() e.forceKills = (e.forceKills or 0) + 1 end}
  local function timer(delay, callback, repeating)
    local t = {at = e.now + delay, callback = callback, interval = repeating and delay}
    function t:stop() self.stopped = true end
    e.timers[#e.timers + 1] = t
    return t
  end
  hs = {
    timer = {absoluteTime = function() return e.now * 1e9 end,
      doAfter = function(delay, callback) return timer(delay, callback) end,
      doEvery = function(delay, callback) return timer(delay, callback, true) end},
    application = {applicationsForBundleID = function() return e.absent and {} or {app} end,
      watcher = {launched = 1, terminated = 2, new = function(callback)
        e.listener = watcher(callback); return e.listener
      end}},
    axuielement = {applicationElement = function()
      return {attributeValue = function() return {attributeValue = function()
        return e.menu and {{attributeValue = function() return "Meeting" end}} or {}
      end} end}
    end},
    uielement = {watcher = {windowCreated = 1, focusedWindowChanged = 2,
      mainWindowChanged = 3, titleChanged = 4, elementDestroyed = 5}},
    screen = {mainScreen = function() return {frame = function()
      return {x = 0, y = 0, w = 1200, h = 800}
    end} end},
    hotkey = {bind = function(mods, key, callback)
      eq(#mods, 0)
      local h = {callback = callback}; function h:delete() self.deleted = true end
      e.keys[key] = h
      return h
    end},
    canvas = {new = function(frame)
      local v = {elements = {}, bounds = frame}
      for _, method in ipairs({"level", "behavior", "clickActivating", "show"}) do
        v[method] = function(self) return self end
      end
      function v:appendElements(...)
        local elements = {...}
        if not elements[1].type then elements = elements[1] end
        for _, element in ipairs(elements) do self.elements[#self.elements + 1] = element end
        return self
      end
      function v:elementAttribute(index, key, value)
        if value == nil then return self.elements[index][key] end
        self.elements[index][key] = value; return self
      end
      function v:frame(value) if value then self.bounds = value; return self end; return self.bounds end
      function v:mouseCallback(callback) self.callback = callback; return self end
      function v:delete() self.deleted = true end
      e.views[#e.views + 1] = v
      return v
    end},
  }
  spoon = {HoldToQuit = dofile(ROOT .. "Spoons/HoldToQuit.spoon/init.lua")}
  function e:advance(seconds)
    local target = self.now + seconds
    while true do
      local nextTimer
      for _, t in ipairs(self.timers) do
        if not t.stopped and not t.fired and t.at <= target
          and (not nextTimer or t.at < nextTimer.at) then nextTimer = t end
      end
      if not nextTimer then break end
      self.now = nextTimer.at
      if nextTimer.interval then nextTimer.at = nextTimer.at + nextTimer.interval
      else nextTimer.fired = true end
      nextTimer.callback()
    end
    self.now = target
  end
  function e:ended()
    self.meeting = false; self.ax.callback(nil, 2); self:advance(2)
    return self.views[#self.views]
  end
  function e:press(key) self.keys[key].callback() end
  e.mod = dofile(ROOT .. "zoomwatcher.lua"); e.mod.setup(); e:advance(0)
  return e
end
local function test(name, fn) fn(); count = count + 1; print("PASS " .. name) end

test("HoldToQuit ring animates smoothly and closes after five seconds", function()
  local e = fixture(); local v = e:ended()
  eq(v.elements[3].type, "arc"); eq(v.elements[3].endAngle, -90)
  eq(v.elements[5].text, "5"); eq(v.bounds.h, 252)
  e:advance(0.5); assert(v.elements[3].endAngle > -90)
  assert(v.elements[3].endAngle < -45); eq(e.kills, 0)
  e:advance(4.49); eq(e.kills, 0)
  e:advance(0.01); eq(e.kills, 1); eq(v.deleted, true)
end)
test("Enter, keypad Enter and Escape cancel and clean up shortcuts", function()
  for _, key in ipairs({"return", "padenter", "escape"}) do
    local e = fixture(); local v = e:ended(); e:press(key)
    e:advance(10); eq(e.kills, 0); eq(v.deleted, true)
    for _, hotkey in pairs(e.keys) do eq(hotkey.deleted, true) end
    eq(_G.ZoomWatcher.quitPending, nil)
    e.ax.callback(nil, 2); e:advance(10); eq(#e.views, 1)
  end
end)
test("Cancel button and its label cancel", function()
  for _, id in ipairs({"cancel", "cancelLabel"}) do
    local e = fixture(); local v = e:ended(); v.callback(v, "mouseUp", id)
    e:advance(10); eq(e.kills, 0); eq(v.deleted, true)
  end
end)
test("Cmd+Q quits immediately through HoldToQuit without hold or repeat", function()
  local e = fixture(); e:ended(); spoon.HoldToQuit:onKeyDown()
  eq(e.kills, 1); eq(spoon.HoldToQuit._holding, false)
  eq(spoon.HoldToQuit._keyDown, true); eq(spoon.HoldToQuit._hud, nil)
  -- No frontmost app/timer APIs in this fixture: repeats must not start a hold.
  spoon.HoldToQuit:onKeyDown(); eq(e.kills, 1)
  spoon.HoldToQuit:onKeyUp(); eq(spoon.HoldToQuit._keyDown, false)
  e:advance(5); eq(e.kills, 1)
end)
test("normal hold-to-quit resumes after countdown is cancelled", function()
  local e = fixture(); e:ended(); e:press("return")
  local otherKills = 0
  hs.application.frontmostApplication = function()
    return {name = function() return "Other app" end, kill = function() otherKills = otherKills + 1 end}
  end
  hs.timer.secondsSinceEpoch = function() return e.now end
  hs.timer.delayed = {new = function(delay, callback)
    local t = {}
    function t:start() self.inner = hs.timer.doAfter(delay, callback) end
    function t:stop() if self.inner then self.inner:stop() end end
    return t
  end}
  spoon.HoldToQuit:onKeyDown()
  eq(spoon.HoldToQuit._holding, true)
  e:advance(0.5); eq(otherKills, 0)
  spoon.HoldToQuit:onKeyUp(); e:advance(1); eq(otherKills, 0)
  spoon.HoldToQuit:onKeyDown(); e:advance(1)
  eq(otherKills, 1); eq(e.kills, 0)
  spoon.HoldToQuit:onKeyUp()
end)
test("meeting returning via window event cancels", function()
  local e = fixture(); local v = e:ended()
  e.meeting = true; e.ax.callback(nil, 2); eq(v.deleted, true)
  e:advance(10); eq(e.kills, 0)
end)
test("Meeting menu returning without AX event cancels on safety check", function()
  local e = fixture(); local v = e:ended(); e.menu = true
  e:advance(1.1); eq(e.kills, 0); eq(v.deleted, true)
end)
test("Cmd+Q cannot quit a newly started meeting", function()
  local e = fixture(); e:ended(); e.menu = true
  spoon.HoldToQuit:onKeyDown(); eq(e.kills, 0)
end)
test("process replacement or disappearance cancels", function()
  for _, change in ipairs({function(e) e.pid = 2 end, function(e) e.absent = true end}) do
    local e = fixture(); local v = e:ended(); change(e)
    e:advance(10); eq(e.kills, 0); eq(v.deleted, true)
  end
end)
test("Zoom termination cancels immediately", function()
  local e = fixture(); local v = e:ended()
  e.listener.callback(nil, hs.application.watcher.terminated, {pid = function() return 1 end})
  eq(v.deleted, true); e:advance(10); eq(e.kills, 0)
end)
test("reload cancels countdown and ignores stale quit callback", function()
  local e = fixture(); local v = e:ended(); local stale = _G.ZoomWatcher.quitPending
  e.mod = dofile(ROOT .. "zoomwatcher.lua"); e.mod.setup()
  eq(v.deleted, true); eq(stale(), false); e:advance(10); eq(e.kills, 0)
end)
test("transient meeting window churn does not prompt", function()
  local e = fixture(); e.meeting = false; e.ax.callback(nil, 2)
  e:advance(1); e.meeting = true; e.ax.callback(nil, 2); e:advance(10)
  eq(#e.views, 0); eq(e.kills, 0)
end)
print(count .. " Zoom watcher tests passed")
