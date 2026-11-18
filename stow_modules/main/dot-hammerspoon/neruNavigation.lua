-- Neru navigation with Mouseless fallback. No installation, service registration, or implicit
-- profile switch at startup. The default profile leaves Mouseless in charge.
local shell = require("shell")
local palette = require("palette")
local CapsHyper = require("caps_hyper")
local Preset = require("preset")
local Layouts = require("neruLayouts")
local ConfigWatcher = require("neruConfigWatcher")

local M = {}
local SETTING = "neruNavigation.backend"
local mouseModes = {recursive_grid = true, grid = true, scroll = true}
local gridCommand = "recursive_grid --cursor-selection-mode hold --toggle"
local gridModes = {recursive_grid = true, grid = true}
local instance

function M.setup(ctx)
  if instance then instance.close() end
  local configured = hs.settings.get(SETTING)
  local state = {
    backend = configured == "neru" and "neru" or configured == "disarmed" and "disarmed" or "mouseless",
    mode = "idle", busy = false, epoch = 0, watchEpoch = 0, handles = {}, closed = false,
    dragHeld = false, dragDesired = false, dragPreparing = false, dragFollowing = false,
    dragCleanupBlocked = false, dragLatched = false, holdToken = 0, holdResetting = false,
    consumedDropKeys = {},
    modeEpoch = 0,
    continuous = hs.settings.get("neruNavigation.continuous") == true,
    layout = Layouts.current(),
  }
  instance = state

  local function message(text) Preset.displayMessage(text, 3) end
  local function rearmTaps()
    if state.inputHandler then
      if state.dragTap then state.dragTap:stop() end
      local types = hs.eventtap.event.types
      state.dragTap = hs.eventtap.new({types.flagsChanged, types.mouseMoved, types.keyDown, types.keyUp}, state.inputHandler)
      state.dragTap:start()
    end
    CapsHyper.rearm()
  end
  local function command(args, done)
    -- Neru creates its capture tap when the daemon starts. Recreate our Hyper
    -- tap before entering a mode, and after the reply, without resetting Caps
    -- state. Also rearm on mode_enter from the watch stream below.
    rearmTaps()
    local argv = {"neru"}
    for _, arg in ipairs(args) do argv[#argv + 1] = arg end
    shell.task(argv, function(ok, out)
      if state.closed then return end
      rearmTaps()
      if done then done(ok, out) end
    end)
  end

  local function enableHandles(enabled)
    for _, handle in ipairs(state.handles) do
      if enabled then handle:enable() else handle:disable() end
    end
  end

  -- Mouse-down/up stay local and ordered. Grid drag preparation only moves
  -- the pointer and enables follow; a canceled preparation must never press.
  local function setDrag(wanted)
    if wanted == state.dragHeld then return end
    local types = hs.eventtap.event.types
    state.dragHeld = wanted
    hs.eventtap.event.newMouseEvent(wanted and types.leftMouseDown or types.leftMouseUp,
      hs.mouse.absolutePosition()):setFlags({}):post()
  end

  local syncDrag
  local function restoreFollow()
    state.dragPreparing = true
    command({"toggle-cursor-follow-selection", "--state", "off"}, function(ok)
      state.dragPreparing = false
      if ok then
        state.dragFollowing = false
        syncDrag()
      else
        -- Do not forget an uncertain follow change or spin on retries. No new
        -- local down is allowed until a verified profile restart clears it.
        state.dragCleanupBlocked, state.dragDesired = true, false
        message("Could not restore cursor-hold aiming; restart Neru before dragging again")
      end
    end)
  end
  syncDrag = function()
    if state.dragPreparing or state.dragCleanupBlocked or state.dragLatched then return end
    if not state.dragDesired then
      setDrag(false)
      if state.dragFollowing and gridModes[state.mode] then restoreFollow() end
      return
    end
    if state.dragHeld then return end
    if not gridModes[state.mode] then setDrag(true); return end
    state.dragPreparing = true
    local epoch, modeEpoch = state.epoch, state.modeEpoch
    command({"run", "--stop-on-error", "action move_mouse --selection",
      "toggle-cursor-follow-selection --state on"}, function(ok)
      state.dragPreparing = false
      local valid = epoch == state.epoch and modeEpoch == state.modeEpoch and
        state.backend == "neru" and not state.busy
      if ok and valid and state.dragDesired then
        state.dragFollowing = true
        setDrag(true)
        return
      end
      if not ok and valid then
        state.dragDesired = false
        message("Could not prepare drag; try again")
      end
      -- A preparation can complete after release or a mode transition. Undo
      -- its follow change before preparing a new session; never send a down.
      if gridModes[state.mode] and not state.dragHeld then
        state.dragFollowing = true -- preparation may have enabled it despite a failed reply
        restoreFollow()
      else syncDrag() end
    end)
  end

  local function resetDrag()
    state.modeEpoch = state.modeEpoch + 1
    state.dragDesired, state.dragFollowing, state.dragLatched = false, false, false
    state.holdToken = state.holdToken + 1
    state.holdResetting, state.pendingDrop = false, nil
    setDrag(false)
  end

  state.cancelHold = resetDrag

  local function reconcileDrag(flags)
    if state.dragLatched then return end -- releasing Ctrl must not release a latched hold
    flags = flags or hs.eventtap.checkKeyboardModifiers()
    state.dragDesired = state.watch ~= nil and state.backend == "neru" and not state.busy and
      mouseModes[state.mode] and flags.ctrl and flags.shift and
      not flags.cmd and not flags.alt and not CapsHyper.isHeld() or false
    if not state.dragDesired then setDrag(false) end
    syncDrag()
  end

  -- Scroll auto-cancel: 10s without a keystroke exits Scroll mode. Neru has
  -- no native mode timeout, and its watch stream reports no scroll activity,
  -- so keystrokes are observed on Hammerspoon's (newer, non-consuming) tap.
  local function cancelScrollIdle()
    if state.scrollTimer then state.scrollTimer:stop(); state.scrollTimer = nil end
  end
  local function armScrollIdle()
    cancelScrollIdle()
    if state.closed or state.mode ~= "scroll" then return end
    state.scrollTimer = hs.timer.doAfter(10, function()
      state.scrollTimer = nil
      if not state.closed and state.mode == "scroll" and state.backend == "neru" then
        command({"idle"})
      end
    end)
  end
  state.cancelScrollIdle = cancelScrollIdle

  local function stopWatch()
    state.watchEpoch = state.watchEpoch + 1
    local watcher = state.watch
    state.watch = nil
    if watcher then watcher:terminate() end
    state.mode = "idle"
    cancelScrollIdle()
    resetDrag()
  end

  local function status(done)
    command({"status", "--json"}, function(ok, out)
      local decoded, value = pcall(hs.json.decode, out)
      done(ok and decoded and type(value) == "table" and value or nil)
    end)
  end

  local function readWatchLine(line)
    local ok, event = pcall(hs.json.decode, line)
    if not ok or type(event) ~= "table" then return end
    if event.event == "snapshot" and type(event.status) == "table" then
      resetDrag()
      state.mode = event.status.enabled and event.status.mode or "idle"
      if state.mode == "scroll" then armScrollIdle() else cancelScrollIdle() end
      reconcileDrag()
    elseif event.event == "mode_enter" then
      resetDrag()
      state.mode = event.mode
      rearmTaps()
      if state.mode == "scroll" then armScrollIdle() else cancelScrollIdle() end
      reconcileDrag()
    elseif event.event == "mode_exit" then
      state.mode = "idle"
      cancelScrollIdle()
      resetDrag()
    end
  end

  local function startWatch()
    stopWatch()
    local executable = shell.resolvePath("neru")
    if not executable then return end
    local buffer, epoch, watchEpoch = "", state.epoch, state.watchEpoch
    local watcher
    watcher = hs.task.new(executable, function()
      if state.closed or epoch ~= state.epoch or state.watch ~= watcher then return end
      state.watchEpoch = state.watchEpoch + 1
      state.watch = nil
      state.mode = "idle"
      resetDrag()
      message("Neru status stream ended; reload Hammerspoon after restarting Neru")
    end, function(task, stdout)
      -- hs.task can deliver a final streaming callback with task=nil AFTER
      -- termination. It must not resurrect an old mode or authorize dragging.
      if not task or state.closed or epoch ~= state.epoch or
        watchEpoch ~= state.watchEpoch or state.watch ~= watcher then return false end
      buffer = buffer .. (stdout or "")
      while true do
        local newline = buffer:find("\n", 1, true)
        if not newline then break end
        readWatchLine(buffer:sub(1, newline - 1))
        buffer = buffer:sub(newline + 1)
      end
      if #buffer > 65536 then buffer = "" end
      return true
    end, {"watch", "--event", "mode_enter,mode_exit"})
    watcher:setEnvironment(_TaskEnv)
    state.watch = watcher
    if not watcher:start() then
      state.watch = nil
      state.watchEpoch = state.watchEpoch + 1
      resetDrag()
      message("Could not watch Neru; modifier dragging is unavailable")
    end
  end

  local function launch(args)
    if state.busy then message("Navigation profile switch in progress"); return end
    if state.backend ~= "neru" then message("Select 'Navigation: Use Neru' in the palette first"); return end
    local actual = {table.unpack(args)}
    if state.continuous and args[1] == "hints" then
      for _, arg in ipairs(args) do
        if arg == "--action" then actual[#actual + 1] = "--repeat"; break end
      end
    end
    command(actual, function(ok)
      if not ok then message("Neru command failed; launch Neru or choose Mouseless in the palette") end
    end)
  end

  local function openLayout(name)
    if state.busy or state.backend ~= "neru" then
      message("Select the Neru profile before opening a grid"); return
    end
    if state.mode == "recursive_grid" and state.layout == name then
      command({"idle"}); return
    end
    local changed, err = Layouts.select(name)
    if changed == nil then message("Could not select grid layout: " .. tostring(err)); return end
    state.layout = name
    if changed and state.configWatcher then state.configWatcher.markCurrent() end
    local function open() launch({"run", gridCommand}) end
    if changed then
      command({"config", "reload"}, function(ok)
        if ok then open() else message("Could not reload the grid layout") end
      end)
    else open() end
  end
  state.openRecursive = function() openLayout("recursive") end
  state.openGrid = function() launch({"grid", "--cursor-selection-mode", "hold", "--toggle"}) end
  state.rightShift = function()
    if gridModes[state.mode] then command({"idle"}) else state.openGrid() end
  end

  -- The actual click runs in Neru first. This callback only decides whether
  -- to leave its overlay up; it never schedules a delayed mouse-down.
  state.afterClick = function()
    if state.closed or state.busy or state.mode == "vim" or state.mode == "monitor_select" then return end
    if not state.continuous then
      command({"idle"})
    elseif gridModes[state.mode] then
      command({"run", "action reset"})
    elseif state.mode == "hints" then
      command({"action", "refresh_hints"})
    end
  end
  local function commitCursor(done)
    local epoch, modeEpoch = state.epoch, state.modeEpoch
    local function finish(ok)
      if epoch == state.epoch and modeEpoch == state.modeEpoch and not state.closed then done(ok) end
    end
    if state.mode == "vim" then
      command({"action", "feed", "--mode", "g", "h"}, finish)
    else
      command({"action", "move_mouse", "--selection"}, function(ok)
        if epoch ~= state.epoch or modeEpoch ~= state.modeEpoch or state.closed then return end
        if ok then finish(true) else command({"action", "move_mouse", "--bare"}, finish) end
      end)
    end
  end

  state.moveOnly = function()
    if state.closed or state.busy then return end
    commitCursor(function(ok)
      if ok then state.afterClick() else message("Could not move the cursor") end
    end)
  end

  state.startHold = function()
    if state.closed or state.busy or state.backend ~= "neru" or state.dragLatched then return end
    if not gridModes[state.mode] and state.mode ~= "vim" then return end
    if state.dragHeld or state.dragPreparing or state.dragCleanupBlocked then
      message("Finish the current drag first"); return
    end
    state.dragLatched = true
    state.holdToken = state.holdToken + 1
    local token = state.holdToken
    commitCursor(function(ok)
      if not state.dragLatched or token ~= state.holdToken then return end
      if not ok then state.dragLatched = false; message("Could not start drag"); return end
      setDrag(true) -- local ordered down: no delayed CLI mouse-down can outlive cancellation
      if gridModes[state.mode] then
        state.holdResetting = true
        command({"run", "action reset"}, function(reset)
          if not state.dragLatched or token ~= state.holdToken then return end
          state.holdResetting = false
          if not reset then
            state.dragLatched, state.pendingDrop = false, nil
            setDrag(false); message("Could not reset the grid for dragging")
          elseif state.pendingDrop then
            local exit = state.pendingDrop.exitVim
            state.pendingDrop = nil
            state.dropHold(exit, true) -- no destination accepted yet: drop at the source
          end
        end)
      end
    end)
  end

  state.dropHold = function(exitVim, atCurrentPoint)
    if not state.dragLatched then return end
    if state.holdResetting then state.pendingDrop = {exitVim = exitVim}; return end
    state.holdToken = state.holdToken + 1 -- cancel an unfinished start or earlier drop
    local token = state.holdToken
    local function release(ok)
      if token ~= state.holdToken or not state.dragLatched then return end
      state.dragLatched = false
      setDrag(false)
      if not ok then message("Drag canceled: could not move to the destination"); return end
      if state.mode == "vim" then
        if exitVim then command({"idle"}) end
      else state.afterClick() end
    end
    if not state.dragHeld or atCurrentPoint then release(true)
    elseif state.mode == "vim" then release(true) -- Vim motions follow its real pointer
    else commitCursor(release) end
  end

  local function toggleContinuous()
    if state.backend ~= "neru" or state.busy then return end
    state.continuous = not state.continuous
    hs.settings.set("neruNavigation.continuous", state.continuous)
    message("Continuous clicks " .. (state.continuous and "ON" or "OFF"))
    if state.mode == "hints" then
      local hints = "hints --strategy axtree --action left_click" .. (state.continuous and " --repeat" or "")
      command({"run", "idle", hints})
    end
  end

  state.toggleContinuous = toggleContinuous
  local function commandGrid()
    -- Cmd+F16 is the continuous toggle in every active mode. From idle it is
    -- still the Recursive Grid launcher.
    if state.mode ~= "idle" then toggleContinuous() else state.openRecursive() end
  end

  -- A persisted Neru setting must not steal Mouseless's keys on reload if
  -- its app has been started independently. Require an explicit handoff.
  if state.backend == "neru" and hs.application.get("Mouseless") then
    state.backend = "mouseless"
    message("Mouseless is running; use the palette for an explicit Neru handoff")
  end

  -- Returning the real handle lets fallback free F16 and Hyper+; rather than
  -- leaving a no-op callback that still swallows Mouseless's own shortcuts.
  local function bind(mods, key, label, args)
    local handle = ctx.default:bindOnce(mods, key, label, function() launch(args) end)
    assert(handle, "Neru launchers require Mode:bindOnce to return a hotkey handle")
    state.handles[#state.handles + 1] = handle
  end
  bind(ctx.hyper, ";", "Neru: UI Hints", {"hints", "--strategy", "axtree", "--action", "left_click", "--toggle"})
  state.handles[#state.handles + 1] = ctx.default:bindOnce({}, "F16",
    "Neru: Grid / Idle (Right Shift)", state.rightShift)
  state.handles[#state.handles + 1] = ctx.default:bindOnce({"cmd"}, "F16",
    "Neru: Recursive / Continuous Grid (Cmd+Right Shift)", commandGrid)
  bind(ctx.hyper, ",", "Neru: Vim Text Mode", {"vim", "--toggle"})
  bind(ctx.hyper, "d", "Neru: Scroll", {"scroll", "--toggle"})
  enableHandles(state.backend == "neru")

  local function finishSwitch(backend)
    state.backend, state.busy = backend, false
    state.dragCleanupBlocked = false
    hs.settings.set(SETTING, backend)
    enableHandles(backend == "neru")
    if backend == "neru" then startWatch() end
    message(backend == "neru" and "Neru enabled" or "Mouseless enabled (Right Shift / F16)")
  end

  local function failSwitch(text)
    state.busy, state.backend = false, "disarmed"
    hs.settings.set(SETTING, "disarmed")
    -- Incomplete ownership handoff must stay disarmed across reloads.
    message(text .. "; select a navigation profile again in the palette")
  end

  local function beginSwitch()
    state.busy, state.epoch, state.backend = true, state.epoch + 1, "disarmed"
    hs.settings.set(SETTING, "disarmed")
    enableHandles(false)
    stopWatch()
  end

  local function waitFor(test, done, attempt)
    attempt = attempt or 0
    if state.closed then return end
    if test() then done(true)
    elseif attempt >= 40 then done(false)
    else hs.timer.doAfter(0.25, function() waitFor(test, done, attempt + 1) end) end
  end

  local function useNeru()
    if state.busy then return end
    if not shell.resolvePath("neru") then message("Install Neru before enabling it"); return end
    beginSwitch()
    local mouseless = hs.application.get("Mouseless")
    if mouseless then mouseless:kill() end
    waitFor(function() return not hs.application.get("Mouseless") end, function(quit)
      if not quit then failSwitch("Mouseless did not quit; Neru was not started"); return end
      shell.task({"open", "-a", "Neru"}, function(opened)
        if state.closed then return end
        if not opened then failSwitch("Could not open Neru"); return end
        -- open returns before the IPC socket is necessarily ready.
        local function ready(attempt)
          status(function(value)
            if value then
              local function activate()
                command({"idle"}, function(ok)
                  if ok then finishSwitch("neru") else failSwitch("Could not idle Neru") end
                end)
              end
              if value.enabled then activate()
              else command({"start"}, function(ok)
                if ok then activate() else failSwitch("Could not resume Neru") end
              end) end
            elseif attempt >= 20 then failSwitch("Neru did not become ready")
            else hs.timer.doAfter(0.25, function() ready(attempt + 1) end) end
          end)
        end
        ready(0)
      end)
    end)
  end

  local function useMouseless()
    if state.busy then return end
    beginSwitch()
    local function openMouseless()
      shell.task({"open", "-a", "Mouseless"}, function(ok)
        if state.closed then return end
        if ok then finishSwitch("mouseless") else failSwitch("Could not open Mouseless") end
      end)
    end
    command({"stop"}, function()
      status(function(value)
        if value and value.enabled == false then openMouseless(); return end
        if value then failSwitch("Neru is still enabled; Mouseless was not opened"); return end
        -- A missing CLI/socket is not sufficient evidence that the capture app
        -- exited. Check the daemon process before starting its competitor.
        local probe
        probe = hs.task.new("/usr/bin/pgrep", function(exitCode)
          state.probe = nil
          if state.closed then return end
          if exitCode == 1 then openMouseless() -- pgrep's explicit no-match code
          else failSwitch("Cannot verify Neru is stopped") end
        end, {"-x", "neru"})
        state.probe = probe
        if not probe:start() then
          state.probe = nil
          failSwitch("Could not check the Neru process")
        end
      end)
    end)
  end

  -- Restarts are stronger than a profile switch: quit both apps for real,
  -- confirm process exit, then start only the requested app. This mirrors the
  -- mutually-exclusive dictation-app restart workflow. Never run at setup.
  local function quitForRestart(procName, appName, done)
    local epoch = state.epoch
    local function poll(attempt)
      if state.closed or epoch ~= state.epoch then return end
      local probe
      probe = hs.task.new("/usr/bin/pgrep", function(code)
        if state.exitProbe == probe then state.exitProbe = nil end
        if state.closed or epoch ~= state.epoch then return end
        if code == 1 then done(true); return end
        if code ~= 0 or attempt >= 40 then done(false); return end
        if attempt == 0 then
          local app = hs.application.get(appName)
          if app then app:kill() end
          -- SIGTERM is Neru's supported graceful daemon shutdown. The check
          -- below, not killall's exit status, determines whether it quit.
          shell.task({"killall", "-TERM", procName}, function()
            if state.closed or epoch ~= state.epoch then return end
            hs.timer.doAfter(0.25, function() poll(attempt + 1) end)
          end)
        else hs.timer.doAfter(0.25, function() poll(attempt + 1) end) end
      end, {"-x", procName})
      state.exitProbe = probe
      if not probe:start() then state.exitProbe = nil; done(false) end
    end
    poll(0)
  end

  local function restartTo(backend)
    if state.busy then message("Navigation profile switch in progress"); return end
    if backend == "neru" and not shell.resolvePath("neru") then
      message("Install Neru before restarting it"); return
    end
    beginSwitch()
    local peerProc = backend == "neru" and "mouseless" or "neru"
    local peerApp = backend == "neru" and "Mouseless" or "Neru"
    local targetProc = backend == "neru" and "neru" or "mouseless"
    local targetApp = backend == "neru" and "Neru" or "Mouseless"
    quitForRestart(peerProc, peerApp, function(peerGone)
      if not peerGone then failSwitch(peerApp .. " did not quit; " .. targetApp .. " was not started"); return end
      quitForRestart(targetProc, targetApp, function(targetGone)
        if not targetGone then failSwitch(targetApp .. " did not quit; restart aborted"); return end
        state.busy = false
        if backend == "neru" then useNeru() else useMouseless() end
      end)
    end)
  end
  state.restartNeru = function() restartTo("neru") end
  state.restartMouseless = function() restartTo("mouseless") end

  palette.registerDynamicBinding("neru.use", function()
    return {name = "Navigation: Use Neru", fn = useNeru}
  end)
  palette.registerDynamicBinding("neru.fallback", function()
    return {name = "Navigation: Use Mouseless (F16)", fn = useMouseless}
  end)
  local extras = {
    {"Vim Text Navigation", {"vim", "--toggle"}},
    {"Search UI Hints", {"hints", "--strategy", "axtree", "--search", "--action", "left_click"}},

    {"Bisect", {"bisect", "--toggle"}},
    {"Monitor Select", {"monitor_select", "--toggle"}},
    {"Reset Mouse Grid", {"run", "action reset"}},
    {"Exit Mode", {"idle"}},
    {"Reload Config", {"config", "reload"}},
  }
  for _, extra in ipairs(extras) do
    local name, args = extra[1], extra[2]
    palette.registerDynamicBinding("neru." .. name, function()
      if state.backend ~= "neru" then return nil end
      return {name = "Neru: " .. name, fn = function() launch(args) end}
    end)
  end

  palette.registerDynamicBinding("neru.Grid", function()
    if state.backend ~= "neru" then return nil end
    return {name = "Neru: Mouseless Layout", fn = function() openLayout("mouseless") end}
  end)
  palette.registerDynamicBinding("neru.RecursiveGrid", function()
    if state.backend ~= "neru" then return nil end
    return {name = "Neru: Recursive Grid (Cmd+Right Shift)", fn = state.openRecursive}
  end)
  palette.registerDynamicBinding("neru.continuous", function()
    if state.backend ~= "neru" then return nil end
    return {name = "Neru: Continuous Clicks " .. (state.continuous and "ON" or "OFF"), fn = toggleContinuous}
  end)

  local eventTypes = hs.eventtap.event.types
  state.inputHandler = function(event)
    if event:getType() == eventTypes.keyUp then
      if state.consumedDropKeys[event:getKeyCode()] then state.consumedDropKeys[event:getKeyCode()] = nil; return true end
      return false
    end
    if event:getType() == eventTypes.keyDown then
      if state.mode == "scroll" then armScrollIdle() end -- any keystroke is activity
      local code = event:getKeyCode()
      if state.consumedDropKeys[code] then return true end
      if (code == 49 or code == 36) and next(state.consumedDropKeys) then
        state.consumedDropKeys[code] = true
        return true -- overlapping Space/Enter holds belong to the same drop
      end
      if state.dragLatched then
        local key, flags = event:getKeyCode(), event:getFlags()
        if (key == 49 or key == 36) and not flags.ctrl and not flags.alt and not flags.cmd and not flags.shift then
          state.consumedDropKeys[key] = true -- suppress each key through its matching key-up
          state.dropHold(key == 36)
          return true -- release, rather than generating a second click
        end
        if state.holdResetting and gridModes[state.mode] and key ~= 53 and key ~= 51 and key ~= 106 and
          not flags.cmd and not flags.alt then return true end -- wait for the base grid before destination input
      end
      return false
    end
    if event:getType() == eventTypes.mouseMoved then
      -- Neru tracks only buttons it pressed itself, so its pointer moves are
      -- mouseMoved rather than mouseDragged during our local modifier drag.
      if state.dragHeld then event:setType(eventTypes.leftMouseDragged):setFlags({}) end
      return false
    end
    local flags = event:getFlags()

    if state.backend ~= "neru" or state.busy then return false end
    -- Preserve Shift+Control hold-to-drag without confusing Hyper+Shift with
    -- dragging. Sticky modifiers are disabled in the Neru configuration.
    reconcileDrag(flags)
    return false
  end
  rearmTaps()

  state.close = function()
    if state.closed then return end
    state.closed, state.epoch = true, state.epoch + 1
    -- A reload can interrupt a modifier drag before its key-up. Exit Neru
    -- explicitly so its tracked mouse buttons are released even then.
    if state.backend == "neru" then shell.task({"neru", "idle"}) end
    for _, handle in ipairs(state.handles) do handle:delete() end
    stopWatch()
    if state.configWatcher then state.configWatcher.stop() end
    if state.probe then state.probe:terminate(); state.probe = nil end
    if state.exitProbe then state.exitProbe:terminate(); state.exitProbe = nil end
    state.dragTap:stop()
  end
  local previousShutdown = hs.shutdownCallback
  hs.shutdownCallback = function()
    state.close()
    if previousShutdown then previousShutdown() end
  end
  state.configWatcher = ConfigWatcher.start(function()
    if state.closed or state.backend ~= "neru" then return end
    status(function(value)
      if not value or not value.enabled then return end -- saved config loads on the next start
      resetDrag()
      command({"config", "reload"}, function(ok)
        if not ok then message("Neru config reload failed; previous configuration kept") end
      end)
    end)
  end)
  if state.backend == "neru" then startWatch(); CapsHyper.rearm() end
  return state
end

-- Called by mode-local Neru macros through the existing authenticated hs CLI.
function M.afterClick()
  if instance and not instance.closed then instance.afterClick() end
end

function M.openRecursive()
  if instance and not instance.closed then instance.openRecursive() end
end

function M.openGrid()
  if instance and not instance.closed then instance.openGrid() end
end

function M.moveOnly()
  if instance and not instance.closed then instance.moveOnly() end
end

function M.toggleContinuous()
  if instance and not instance.closed then instance.toggleContinuous() end
end

function M.startHold()
  if instance and not instance.closed then instance.startHold() end
end

function M.cancelHold()
  if instance and not instance.closed then instance.cancelHold() end
end

function M.status()
  if not instance then return nil end
  return {backend = instance.backend, mode = instance.mode, continuous = instance.continuous,
    layout = instance.layout, busy = instance.busy, leftHeld = instance.dragHeld,
    heldDrag = instance.dragLatched}
end

return M
