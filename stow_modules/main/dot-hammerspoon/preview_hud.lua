-- Preview HUD.
--
-- A HUD that renders a transient *preview* of some action on screen and, once an
-- exit condition fires, optionally *applies* the previewed action for real. The
-- typical flow is:
--
--   hud:enter({ preview = ..., apply = function() ... end, preview_type = "..." })
--
-- while the hyper key is held (or across several presses), each enter() re-renders
-- the latest preview; when the exit condition triggers, the last action's apply()
-- runs. This lets a key sequence show what *would* happen before committing to it.
--
-- Two flavors are provided as singletons on the module:
--   M.HYPER_RELEASE -- exits (and applies) when the hyper key is released.
--   M.MANUAL        -- exits only when hud:exit() is called explicitly.
--
-- The render() dispatch is table-driven (see `renderers` below) so new preview
-- types can be added without touching the class methods.

-- For the hyper-release flavor below: the Caps Lock hyper key is not a real
-- modifier, so its release has to be observed at the source. caps_hyper pulls
-- in nothing but util, so this is cycle-free.
local CapsHyper = require("caps_hyper")

local M = {}

---------------------------------------------------------------
-- Renderers: preview_type -> function(self, preview)
--
-- Each renderer draws something and stashes a handle on `self` so clear() can
-- tear it down. clear() knows about every handle type, so a renderer only needs
-- to set the handle it uses.
---------------------------------------------------------------

local renderers = {}
M.renderers = renderers

-- Persistent centered text message (stays until cleared).
function renderers.display_message(self, preview)
  local message = type(preview) == "table" and (preview.text or preview.message) or preview
  self._alertUUID = hs.alert.show(tostring(message), {
    textStyle = { paragraphStyle = { alignment = "center" } },
  }, true)
end

-- Rectangle drawn with hs.canvas. `preview` is a frame plus optional styling:
--   { x, y, w, h, fillColor, strokeColor, strokeWidth, radius }
function renderers.rectangle(self, preview)
  local canvas = hs.canvas.new({
    x = preview.x, y = preview.y, w = preview.w, h = preview.h,
  })
  local radius = preview.radius or 8
  canvas[1] = {
    type = "rectangle",
    action = "strokeAndFill",
    strokeColor = preview.strokeColor or { red = 0.2, green = 0.6, blue = 1.0, alpha = 0.9 },
    fillColor = preview.fillColor or { red = 0.2, green = 0.6, blue = 1.0, alpha = 0.15 },
    strokeWidth = preview.strokeWidth or 4,
    roundedRectRadii = { xRadius = radius, yRadius = radius },
  }
  canvas:show()
  self._canvas = canvas
end

---------------------------------------------------------------
-- PreviewHud base class
---------------------------------------------------------------

local PreviewHud = {}
PreviewHud.__index = PreviewHud
M.PreviewHud = PreviewHud

-- Make the HUD ready to display and bind its exit condition. Idempotent: calling
-- init() while already initialized is a no-op. exit() undoes this so init() can
-- run again for the next preview session.
function PreviewHud:init()
  if self._initialized then return end
  self._initialized = true
  self:bindExit()
end

-- Hook: bind whatever triggers exit() (an eventtap, timer, ...). The base class
-- binds nothing, i.e. exit is manual. Subclasses override this.
function PreviewHud:bindExit() end

-- Hook: undo bindExit(). The base class has nothing to undo.
function PreviewHud:unbindExit() end

-- Store the action and render its preview, initializing first if needed. The
-- action is kept so exit() can apply() it later.
--
-- action = { preview = <arg>, apply = function() ... end, preview_type = <string> }
function PreviewHud:enter(action)
  self:init()
  self.action = action
  self:render(action)
end

-- Draw the action's preview according to its preview_type, clearing whatever was
-- drawn before.
function PreviewHud:render(action)
  self:clear()
  local renderer = renderers[action.preview_type]
  if renderer then renderer(self, action.preview) end
end

-- Remove anything drawn on screen. Idempotent.
function PreviewHud:clear()
  if self._alertUUID then
    hs.alert.closeSpecific(self._alertUUID)
    self._alertUUID = nil
  end
  if self._canvas then
    self._canvas:delete()
    self._canvas = nil
  end
end

-- Clear the screen, tear down the exit binding, reset to the uninitialized state,
-- then apply the stored action's effect (if any). Applying last means the screen
-- is already clean when the real action runs.
function PreviewHud:exit()
  if not self._initialized then return end
  self:clear()
  self:unbindExit()
  self._initialized = false
  local action = self.action
  self.action = nil
  if action and action.apply then action.apply() end
end

---------------------------------------------------------------
-- HyperReleasePreviewHUD: exits when the hyper key is released
---------------------------------------------------------------

local HyperReleasePreviewHUD = setmetatable({}, { __index = PreviewHud })
HyperReleasePreviewHUD.__index = HyperReleasePreviewHUD
M.HyperReleasePreviewHUD = HyperReleasePreviewHUD

-- Exit when hyper goes up, which has to be watched two ways.
--
-- Real modifiers (an external keyboard's ctrl+alt+cmd, or Karabiner's hyper)
-- announce themselves through flagsChanged: the moment the three are no longer
-- all held, we are done.
--
-- Caps Lock hyper does not. caps_hyper stamps ctrl/alt/cmd onto other key
-- events rather than holding them, so releasing it changes no flags at all --
-- a HUD raised by a plain hyper+key chord (no shift whose release would show
-- up) would sit there forever. caps_hyper reports its own release instead.
function HyperReleasePreviewHUD:bindExit()
  self._tap = hs.eventtap.new({ hs.eventtap.event.types.flagsChanged }, function(event)
    local flags = event:getFlags()
    if not (flags.ctrl and flags.alt and flags.cmd) then
      self:exit()
    end
    return false
  end)
  self._tap:start()

  self._unsubscribeHyper = CapsHyper.onRelease(function() self:exit() end)
end

function HyperReleasePreviewHUD:unbindExit()
  if self._tap then
    self._tap:stop()
    self._tap = nil
  end
  if self._unsubscribeHyper then
    self._unsubscribeHyper()
    self._unsubscribeHyper = nil
  end
end

---------------------------------------------------------------
-- HyperCycleHUD: hyper-release, and also gone the moment a DIFFERENT key is
-- pressed
--
-- For the window-rotation HUDs (hyper+x, hyper+z, hyper+e/r), which label
-- "where the last press landed you". Repeating the same chord is another step
-- in the same rotation, so the HUD updates in place; any other key means the
-- answer on screen is now stale -- hyper+e twice then hyper+r switches to a
-- Personal window while the HUD still names the Meta one -- so it comes down,
-- whether or not that key goes on to raise a HUD of its own.
--
-- Waiting for the release alone isn't enough precisely because the next chord
-- may not raise anything: hyper+r off a Meta window switches profile through
-- the menu bar and never enters a HUD to overwrite this one.
--
-- This flavor applies nothing, so dismissing early costs nothing. That is why
-- the layout previews can't work this way: there, each press iterates on the
-- previous action (hud.action feeds the next stop) and applies it on release,
-- both of which an early exit would throw away.
---------------------------------------------------------------

local HyperCycleHUD = setmetatable({}, { __index = HyperReleasePreviewHUD })
HyperCycleHUD.__index = HyperCycleHUD
M.HyperCycleHUD = HyperCycleHUD

-- The key that raised this HUD is simply the last one pressed: the binding runs
-- from that keypress, even when it only gets here a subprocess later.
function HyperCycleHUD:enter(action)
  self._ownerKey = CapsHyper.lastKeyCode()
  HyperReleasePreviewHUD.enter(self, action)
end

function HyperCycleHUD:bindExit()
  HyperReleasePreviewHUD.bindExit(self)

  -- Runs before the hotkey it belongs to, so a repeat of the owning chord exits
  -- nothing and the binding's own enter() re-renders in place -- no flicker --
  -- while any other key tears the HUD down first.
  self._keyTap = hs.eventtap.new({ hs.eventtap.event.types.keyDown }, function(event)
    if event:getKeyCode() ~= self._ownerKey then self:exit() end
    return false
  end)
  self._keyTap:start()
end

function HyperCycleHUD:unbindExit()
  HyperReleasePreviewHUD.unbindExit(self)
  if self._keyTap then
    self._keyTap:stop()
    self._keyTap = nil
  end
end

---------------------------------------------------------------
-- ManualPreviewHUD: exits only when exit() is called explicitly
---------------------------------------------------------------

-- No exit binding in init(): inherits the base's empty bindExit/unbindExit, so
-- the HUD stays up until something calls hud:exit().
local ManualPreviewHUD = setmetatable({}, { __index = PreviewHud })
ManualPreviewHUD.__index = ManualPreviewHUD
M.ManualPreviewHUD = ManualPreviewHUD

---------------------------------------------------------------
-- Singletons
---------------------------------------------------------------

M.HYPER_RELEASE = setmetatable({}, HyperReleasePreviewHUD)
M.HYPER_CYCLE = setmetatable({}, HyperCycleHUD)
M.MANUAL = setmetatable({}, ManualPreviewHUD)

return M
