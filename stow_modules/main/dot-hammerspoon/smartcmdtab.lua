local shell = require("shell")
local preset = require("preset")

local M = {}

function M.setup(hyper)
  _G.PendingCmdTabAction = nil          -- per Cmd-hold: nil (no press yet) | callback (deferred)
  _G.QuickTerminalAlternateWindowId = nil -- persists across holds: the window we switched to after hiding
  _G.QuickTerminalKind = nil            -- "iterm" | "ghostty": which floating terminal to restore

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

      -- Which floating terminal (if any) is currently up.
      local kind = nil
      if preset.isGhosttyQuickTerminalActive() then
        kind = "ghostty"
      elseif preset.isFloatingTerminalActive() then
        kind = "iterm"
      end

      -- First press: pick an action, defer it until Cmd is released
      local win = hs.window.focusedWindow()
      if QuickTerminalAlternateWindowId and win and win:id() == QuickTerminalAlternateWindowId then
        -- We're on the window we switched to after hiding a floating terminal;
        -- restore whichever terminal that was.
        PendingCmdTabAction = function()
          local restore = QuickTerminalKind
          QuickTerminalAlternateWindowId = nil
          QuickTerminalKind = nil
          if restore == "ghostty" then
            shell.task({"ghostty-preset", "reveal-floating-terminal"})
          else
            shell.task({"iterm-preset", "reveal-hotkey-window"})
          end
        end
      elseif kind then
        -- A floating terminal is up: hide it, then record the window focus lands
        -- on (ground truth) so Cmd+Tab from there reopens it. The hide is async
        -- (term-preset -> ghostty/iterm -> CGEvent/osascript, and Ghostty's F17
        -- toggle settles a beat later), so poll for focus to leave the floating
        -- terminal instead of reading it after a fixed sleep or guessing the
        -- z-order beforehand (both of which mismatched the landed window).
        local floatingId = win and win:id()
        PendingCmdTabAction = function()
          QuickTerminalKind = kind
          QuickTerminalAlternateWindowId = nil
          shell.task({"term-preset", "hide-floating-terminal"}, function()
            local tries = 0
            local function capture()
              local f = hs.window.focusedWindow()
              if f and f:id() ~= floatingId then
                QuickTerminalAlternateWindowId = f:id()
              elseif tries < 30 then
                tries = tries + 1
                hs.timer.doAfter(0.02, capture)
              end
            end
            capture()
          end)
        end
      else
        PendingCmdTabAction = function()
          QuickTerminalAlternateWindowId = nil
          QuickTerminalKind = nil
          shell.task({"wm-preset", "focus-recent"})
        end
      end

      return true  -- consume the event
    end
  )
  CmdTabTap:start()
end

return M
