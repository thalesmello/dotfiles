local shell = require("shell")
local mode = require("mode")

local M = {}

function M.setup(hyper)
  _G.CmdTabCount = 0
  _G.FloatingTerminalJustHidden = false
  _G.WindowAfterHide = nil

  _G.CmdTabTap = hs.eventtap.new(
    {hs.eventtap.event.types.keyDown, hs.eventtap.event.types.flagsChanged},
    function(event)
      local type = event:getType()
      local flags = event:getFlags()

      -- On Cmd release: reset counter
      if type == hs.eventtap.event.types.flagsChanged then
        if not flags.cmd then
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
        -- First press: custom behavior
        local focusedWin = hs.window.focusedWindow()
        local focusedWinId = focusedWin and focusedWin:id()
        if FloatingTerminalJustHidden and WindowAfterHide and focusedWinId == WindowAfterHide then
          FloatingTerminalJustHidden = false
          WindowAfterHide = nil
          hs.eventtap.keyStroke(hyper, "/", 0)
        elseif mode.isFloatingTerminal() then
          FloatingTerminalJustHidden = true
          WindowAfterHide = nil
          hs.osascript.applescript('tell application "iTerm2" to hide hotkey window current window')
          hs.timer.usleep(200000)
          local win = hs.window.focusedWindow()
          WindowAfterHide = win and win:id()
        else
          FloatingTerminalJustHidden = false
          WindowAfterHide = nil
          shell.task({"wm-preset", "focus-recent"})
        end
        return true  -- consume the event
      else
        -- Second+ press: let native App Switcher handle it
        return false
      end
    end
  )
  CmdTabTap:start()
end

return M
