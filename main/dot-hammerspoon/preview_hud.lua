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

-- Watch modifier changes; the moment ctrl+alt+cmd are no longer all held, exit.
function HyperReleasePreviewHUD:bindExit()
  self._tap = hs.eventtap.new({ hs.eventtap.event.types.flagsChanged }, function(event)
    local flags = event:getFlags()
    if not (flags.ctrl and flags.alt and flags.cmd) then
      self:exit()
    end
    return false
  end)
  self._tap:start()
end

function HyperReleasePreviewHUD:unbindExit()
  if self._tap then
    self._tap:stop()
    self._tap = nil
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
M.MANUAL = setmetatable({}, ManualPreviewHUD)

return M
