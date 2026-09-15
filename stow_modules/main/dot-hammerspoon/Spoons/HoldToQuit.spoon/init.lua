--- === HoldToQuit ===
---
--- Instead of pressing ⌘Q, hold ⌘Q to close applications.

local obj = {}
obj.__index = obj

-- Metadata
obj.name = "HoldToQuit"
obj.version = "1.1"
obj.author = "Matthias Strauss <matthias.strauss@mayflower.de>"
obj.github = "@MattFromGer"
obj.homepage = "https://github.com/Hammerspoon/Spoons"
obj.license = "MIT - https://opensource.org/licenses/MIT"

--- HoldToQuit.duration
--- Variable
--- Integer containing the duration (in seconds) how long to hold
--- the hotkey. Default 1.
obj.duration = 1

--- HoldToQuit.defaultHotkey
--- Variable
--- Default hotkey mapping
obj.defaultHotkey = {
    quit = { {"cmd"}, "Q" }
}

--- HoldToQuit.hotkeyQbj
--- Variable
--- Hotkey object
obj.hotkeyQbj = nil

--- HoldToQuit.timer
--- Variable
--- Timer for counting the holding time
obj.timer = nil

-- HUD state for the hold-to-quit visual countdown.
obj._hud = nil
obj._progressTimer = nil
obj._startedAt = nil
obj._targetApp = nil
obj._holding = false
obj._keyDown = false

local HUD_WIDTH = 360
local HUD_HEIGHT = 220
local RING_CENTER = { x = HUD_WIDTH / 2, y = 82 }
local RING_RADIUS = 44
local RING_WIDTH = 8
local PROGRESS_ELEMENT = 3
local STATUS_ELEMENT = 7

local COLORS = {
    background = { white = 0.06, alpha = 0.88 },
    border = { white = 1.0, alpha = 0.14 },
    text = { white = 1.0, alpha = 1.0 },
    muted = { white = 1.0, alpha = 0.68 },
    track = { white = 1.0, alpha = 0.16 },
    progress = { red = 0.25, green = 0.62, blue = 1.0, alpha = 0.96 },
    keyBackground = { white = 1.0, alpha = 0.11 },
}

local function clamp(value, minValue, maxValue)
    if value < minValue then return minValue end
    if value > maxValue then return maxValue end
    return value
end

local function appName(app)
    if not app then return "current app" end
    local ok, name = pcall(function() return app:name() end)
    if ok and name and name ~= "" then return name end
    return "current app"
end

local function appScreen(app)
    if app then
        local ok, win = pcall(function() return app:focusedWindow() end)
        if ok and win then
            local screen = win:screen()
            if screen then return screen end
        end
    end
    return hs.screen.mainScreen()
end

function obj:_holdDuration()
    return math.max(0.05, tonumber(self.duration) or 1)
end

function obj:_newHUD(app)
    local screenFrame = appScreen(app):frame()
    local frame = {
        x = math.floor(screenFrame.x + (screenFrame.w - HUD_WIDTH) / 2),
        y = math.floor(screenFrame.y + (screenFrame.h - HUD_HEIGHT) / 2),
        w = HUD_WIDTH,
        h = HUD_HEIGHT,
    }

    local canvas = hs.canvas.new(frame)
    canvas:level("overlay")
    canvas:behavior({ "canJoinAllSpaces", "stationary" })
    canvas:clickActivating(false)

    canvas:appendElements({
        {
            type = "rectangle",
            action = "strokeAndFill",
            frame = { x = 0, y = 0, w = HUD_WIDTH, h = HUD_HEIGHT },
            roundedRectRadii = { xRadius = 20, yRadius = 20 },
            fillColor = COLORS.background,
            strokeColor = COLORS.border,
            strokeWidth = 1,
            withShadow = true,
            shadow = { blurRadius = 24, color = { white = 0, alpha = 0.42 }, offset = { h = -2, w = 0 } },
        },
        {
            type = "circle",
            action = "stroke",
            center = RING_CENTER,
            radius = RING_RADIUS,
            strokeColor = COLORS.track,
            strokeWidth = RING_WIDTH,
        },
        {
            type = "arc",
            action = "stroke",
            center = RING_CENTER,
            radius = RING_RADIUS,
            startAngle = -90,
            endAngle = -90,
            arcClockwise = true,
            arcRadii = false,
            strokeColor = COLORS.progress,
            strokeWidth = RING_WIDTH,
            strokeCapStyle = "round",
        },
        {
            type = "rectangle",
            action = "fill",
            frame = { x = RING_CENTER.x - 26, y = RING_CENTER.y - 20, w = 52, h = 40 },
            roundedRectRadii = { xRadius = 10, yRadius = 10 },
            fillColor = COLORS.keyBackground,
        },
        {
            type = "text",
            action = "fill",
            text = "⌘Q",
            frame = { x = RING_CENTER.x - 60, y = RING_CENTER.y - 14, w = 120, h = 32 },
            textSize = 24,
            textAlignment = "center",
            textColor = COLORS.text,
        },
        {
            type = "text",
            action = "fill",
            text = "Hold ⌘Q to quit " .. appName(app),
            frame = { x = 24, y = 140, w = HUD_WIDTH - 48, h = 34 },
            textSize = 20,
            textAlignment = "center",
            textColor = COLORS.text,
        },
        {
            type = "text",
            action = "fill",
            text = "Release to cancel",
            frame = { x = 24, y = 174, w = HUD_WIDTH - 48, h = 28 },
            textSize = 14,
            textAlignment = "center",
            textColor = COLORS.muted,
        },
    })

    canvas:show()
    return canvas
end

function obj:_setHUDProgress(progress)
    if not self._hud then return end

    progress = clamp(progress or 0, 0, 1)
    -- A 360° arc collapses to an empty path, so keep the final drawn arc just shy
    -- of a full circle. The action fires immediately at 100% anyway.
    local endAngle = -90 + (progress >= 1 and 359.9 or (360 * progress))
    self._hud:elementAttribute(PROGRESS_ELEMENT, "endAngle", endAngle)

    local remaining = 0
    if self._startedAt then
        remaining = math.max(0, self:_holdDuration() - (hs.timer.secondsSinceEpoch() - self._startedAt))
    end
    local status = remaining > 0 and string.format("Release to cancel · %.1fs", remaining) or "Quitting…"
    self._hud:elementAttribute(STATUS_ELEMENT, "text", status)
end

function obj:_showHUD(progress)
    self:_hideHUD()
    self._hud = self:_newHUD(self._targetApp)
    self:_setHUDProgress(progress or 0)
end

function obj:_hideHUD()
    if self._hud then
        self._hud:delete()
        self._hud = nil
    end
end

function obj:_stopProgressTimer()
    if self._progressTimer then
        self._progressTimer:stop()
        self._progressTimer = nil
    end
end

function obj:_stopQuitTimer()
    if self.timer then
        self.timer:stop()
        self.timer = nil
    end
end

function obj:_clearHoldState()
    self:_stopProgressTimer()
    self:_stopQuitTimer()
    self:_hideHUD()
    self._startedAt = nil
    self._targetApp = nil
    self._holding = false
end

function obj:_tickHUD()
    if not self._holding or not self._startedAt then return end
    local elapsed = hs.timer.secondsSinceEpoch() - self._startedAt
    self:_setHUDProgress(elapsed / self:_holdDuration())
end

function obj:_completeHold()
    if not self._holding then return end

    local app = self._targetApp or hs.application.frontmostApplication()
    self:_setHUDProgress(1)
    self:_clearHoldState()

    if app then
        app:kill()
    end
end

--- HoldToQuit.killCurrentApp()
--- Method
--- Kill the frontmost application
---
--- Parameters:
---  * None
function obj:killCurrentApp()
    local app = hs.application.frontmostApplication()
    if app then
        app:kill()
    end
end

--- HoldToQuit:init()
--- Method
--- Initialize spoon
---
--- Parameters:
---  * None
function obj:init()
    self:_clearHoldState()
    self._keyDown = false
    return self
end

--- HoldToQuit:onKeyDown()
--- Method
--- Start timer on keyDown
---
--- Parameters:
---  * None
function obj:onKeyDown()
    -- Ignore key repeat; one physical press should be able to quit at most one app.
    if self._keyDown then return end

    self._keyDown = true
    self._holding = true
    self._targetApp = hs.application.frontmostApplication()
    self._startedAt = hs.timer.secondsSinceEpoch()

    self:_showHUD(0)

    self.timer = hs.timer.delayed.new(self:_holdDuration(), function() self:_completeHold() end)
    self.timer:start()

    self._progressTimer = hs.timer.doEvery(1 / 30, function() self:_tickHUD() end)
end

--- HoldToQuit:onKeyUp()
--- Method
--- Stop Timer & cancel quit
---
--- Parameters:
---  * None
function obj:onKeyUp()
    self._keyDown = false
    if not self._holding then return end
    self:_clearHoldState()
end

--- HoldToQuit:start()
--- Method
--- Start HoldToQuit with default hotkey
---
--- Parameters:
---  * None
function obj:start()
    if (self.hotkeyQbj) then
        self.hotkeyQbj:enable()
    else
        local mod = self.defaultHotkey["quit"][1]
        local key = self.defaultHotkey["quit"][2]
        self.hotkeyQbj = hs.hotkey.bind(mod, key, function() obj:onKeyDown() end, function() obj:onKeyUp() end)
    end
end

--- HoldToQuit:stop()
--- Method
--- Disable HoldToQuit hotkey
---
--- Parameters:
---  * None
function obj:stop()
    self:_clearHoldState()
    self._keyDown = false
    if (self.hotkeyQbj) then
        self.hotkeyQbj:disable()
    end
end

--- HoldToQuit:bindHotkeys(mapping)
--- Method
--- Binds hotkeys for HoldToQuit
---
--- Parameters:
---  * mapping - A table containing hotkey modifier/key details for the following items:
---   * quit - This will define the quit hotkey
function obj:bindHotkeys(mapping)
    self:_clearHoldState()
    self._keyDown = false
    if (self.hotkeyQbj) then
        self.hotkeyQbj:delete()
    end

    local mod = mapping["quit"][1]
    local key = mapping["quit"][2]
    self.hotkeyQbj = hs.hotkey.bind(mod, key, function() obj:onKeyDown() end, function() obj:onKeyUp() end)

    return self
end

return obj
