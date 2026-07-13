local shell = require("shell")
local mode = require("mode")

local M = {}

function M.setup(hyper)
  _G.CmdTabCount = 0
  _G.FloatingTerminalJustHidden = false
  _G.WindowAfterHide = nil
  _G.PendingAction = nil

  _G.CmdTabTap = hs.eventtap.new(
    {hs.eventtap.event.types.keyDown, hs.eventtap.event.types.flagsChanged},
    function(event)
      local type = event:getType()
      local flags = event:getFlags()

      -- On Cmd release: run any pending action, then reset counter
      if type == hs.eventtap.event.types.flagsChanged then
        if not flags.cmd then
          if PendingAction == "restore" then
            FloatingTerminalJustHidden = false
            WindowAfterHide = nil
            hs.eventtap.keyStroke(hyper, "/", 0)
          elseif PendingAction == "hide" then
            FloatingTerminalJustHidden = true
            WindowAfterHide = nil
            hs.osascript.applescript('tell application "iTerm2" to hide hotkey window current window')
            hs.timer.usleep(200000)
            local win = hs.window.focusedWindow()
            WindowAfterHide = win and win:id()
          elseif PendingAction == "focus-recent" then
            FloatingTerminalJustHidden = false
            WindowAfterHide = nil
            shell.task({"wm-preset", "focus-recent"})
          end
          PendingAction = nil
          CmdTabCount = 0
        end
        return false  -- never consume modifier events
      end

      -- Only intercept Tab while Cmd is held (no other modifiers)
      local keyCode = event:getKeyCode()
      if keyCode ~= hs.keycodes.map["tab"] then return false end
      if not flags.cmd then return false end
      if flags.alt or flags.ctrl or flags.shift then return false end

      CmdTabCount = CmdTabCount + 1

      if CmdTabCount == 1 then
        -- First press: decide the action but defer it until Cmd is released
        local focusedWin = hs.window.focusedWindow()
        local focusedWinId = focusedWin and focusedWin:id()
        if FloatingTerminalJustHidden and WindowAfterHide and focusedWinId == WindowAfterHide then
          PendingAction = "restore"
        elseif mode.isFloatingTerminal() then
          PendingAction = "hide"
        else
          PendingAction = "focus-recent"
        end
        return true  -- consume the event
      else
        -- Second+ press: cancel the deferred action and let the native
        -- App Switcher / underlying window handle Cmd+Tab
        PendingAction = nil
        return false
      end
    end
  )
  CmdTabTap:start()
end

return M
