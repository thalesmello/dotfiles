local shell = require("shell")
local preset = require("preset")

local M = {}

function M.setup(hyper)
  _G.PendingCmdTabAction = nil          -- per Cmd-hold: nil (no press yet) | callback (deferred)
  _G.QuickTerminalAlternateWindowId = nil -- persists across holds: window id to restore the terminal into

  _G.CmdTabTap = hs.eventtap.new(
    {hs.eventtap.event.types.keyDown, hs.eventtap.event.types.flagsChanged},
    function(event)
      local flags = event:getFlags()

      -- On Cmd release: run the deferred action (if any), then reset per-hold state
      -- Modifier changes never get consumed; on Cmd release, run the deferred action
      if event:getType() == hs.eventtap.event.types.flagsChanged then
        if flags.cmd or PendingCmdTabAction == nil then
          return false
        end

        PendingCmdTabAction()
        PendingCmdTabAction = nil

        return false
      end

      -- On keyDown

      -- Only intercept Tab while Cmd (and no other modifier) is held
      if event:getKeyCode() ~= hs.keycodes.map["tab"] then return false end
      if not flags.cmd then return false end
      if flags.alt or flags.ctrl or flags.shift then return false end

      -- Second+ press: cancel the deferred action, hand Cmd+Tab to the OS
      if PendingCmdTabAction ~= nil then
        PendingCmdTabAction = function () end
        return false
      end

      -- First press: pick an action, defer it until Cmd is released
      local win = hs.window.focusedWindow()
      if QuickTerminalAlternateWindowId and win and win:id() == QuickTerminalAlternateWindowId then
        PendingCmdTabAction = function()
          QuickTerminalAlternateWindowId = nil
          hs.eventtap.keyStroke(hyper, "/", 0)
        end
      elseif preset.isFloatingTerminalActive() then
        PendingCmdTabAction = function()
          hs.osascript.applescript('tell application "iTerm2" to hide hotkey window current window')
          hs.timer.usleep(200000)
          local hidden = hs.window.focusedWindow()
          QuickTerminalAlternateWindowId = hidden and hidden:id()
        end
      else
        PendingCmdTabAction = function()
          QuickTerminalAlternateWindowId = nil
          shell.task({"wm-preset", "focus-recent"})
        end
      end

      return true  -- consume the event
    end
  )
  CmdTabTap:start()
end

return M
