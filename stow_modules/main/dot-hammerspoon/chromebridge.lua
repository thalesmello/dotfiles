-- Bridge between the Focus History Chrome extension (dotfiles
-- chrome-extensions/focus-history/) and focushistory.lua. Install it with
-- `focus-history-extension install`.
--
-- The data flows ONE WAY: the extension holds a websocket open to a
-- loopback-only hs.httpserver and pushes {type="tab", tabId, windowId, url,
-- title} whenever the active tab changes. Nothing is ever sent back.
--
-- The point is that the tab id arrives with the event that caused it. The
-- previous implementation inferred which tab was active from the window title
-- and correlated it back through AppleScript, and every layer of that inference
-- turned out to be wrong in some real situation.
--
-- Focusing does NOT go through the extension, for two reasons established by
-- measurement rather than reading docs:
--
--   * The ids are interchangeable. Chrome exposes window.id and tab.id to
--     AppleScript as `uniqueID`, and the extension reported chromeWindowId
--     695112779 for the very window AppleScript calls 695112779 -- both are
--     Chrome's process-global SessionID.
--   * hs.httpserver:send() reaches "the websocket client", singular. It is not a
--     broadcast, so with several profiles connected a command reaches exactly one
--     of them.
--
-- So `chrome-preset focus-tab` does the focusing: one AppleScript call that sees
-- every profile in the single Chrome process and activates the app, which no
-- extension API can do anyway.
--
-- MULTIPLE PROFILES. Chrome profiles share one browser process but extensions are
-- per-profile, so load it in each profile you use. Inbound is unaffected by the
-- single-client send limit -- every copy's reports arrive fine -- which is why
-- reporting lives here and commanding does not.

local FocusHistory = require("focushistory")
local shell = require("shell")
local util = require("util")

local M = {}

local PORT = 27123
local WS_PATH = "/focushistory"
-- A tab report means Chrome is frontmost, so the focused window is the one
-- hosting it -- unless the report beat the activation. Retry once if so.
local CGWINDOW_RETRY = 0.1

local st = _G._ChromeBridge
if not st then
  st = {clients = {}}
  _G._ChromeBridge = st
end
st.clients = st.clients or {}

---------------------------------------------------------------
-- Focusing a tab
---------------------------------------------------------------

local CHROME_BUNDLE = "com.google.Chrome"

-- Confirm Chrome actually came forward after focus-tab, and rescue it if not.
--
-- chrome-preset focus-tab ends in chrome.activate(), which is enough whenever the
-- window is on the current Space -- so the common path costs nothing but a couple
-- of cheap frontmost checks. It is NOT enough across Spaces, and only then do we
-- pay for yabai.
--
-- Waiting at all matters for a subtler reason: focushistory suppresses recording
-- while a jump is in flight, so reporting completion before focus has landed lets
-- the window we are leaving get recorded, which truncates the forward branch.
local function raiseChrome(entry, cb)
  local function rescue()
    if entry.cgWindowId then
      -- --wait-focus because a Space switch takes time to settle.
      shell.task({"wm-preset", "focus-window-id", "--wait-focus", entry.cgWindowId},
        function() cb(true) end)
      return
    end
    -- applicationsForBundleID is a plain NSRunningApplication lookup: no AX, and
    -- none of hs.application.find's fall-through to a full window sweep.
    local apps = hs.application.applicationsForBundleID(CHROME_BUNDLE)
    if apps and apps[1] then apps[1]:activate() end
    cb(true)
  end

  local function waitFrontmost(tries)
    local front = hs.application.frontmostApplication()
    if front and front:bundleID() == CHROME_BUNDLE then return cb(true) end
    if tries >= 10 then return rescue() end   -- ~200ms, then assume another Space
    hs.timer.doAfter(0.02, function() waitFrontmost(tries + 1) end)
  end

  waitFrontmost(0)
end

-- Focus a tab via AppleScript, NOT by asking the extension.
--
-- This looks like the long way round and isn't, for two measured reasons.
--
-- 1. The ids are the same. Chrome's scripting dictionary exposes window.id and
--    tab.id as `uniqueID`, and the values the extension reports land in the same
--    counter as the ones AppleScript reports -- observed: the extension gave
--    chromeWindowId 695112779 for the very window AppleScript calls 695112779.
--    Both are Chrome's process-global SessionID. So an id from the extension can
--    be handed straight to AppleScript.
--
-- 2. hs.httpserver:send() reaches "the websocket client", singular. With the
--    extension loaded in several profiles, an activate message only reaches one
--    of them, and the rest had to wait out a 2s timeout before falling back --
--    which is exactly what made focusing feel slow. AppleScript talks to the one
--    Chrome process and therefore sees every profile's tabs.
--
-- chrome-preset focus-tab also calls chrome.activate(), so unlike the extension
-- route (no extension API can activate a macOS app) this raises the window too.
local function focusTab(entry, cb)
  shell.task({"chrome-preset", "focus-tab", tostring(entry.id), tostring(entry.chromeWindowId)},
    function(ok)
      if not ok then return cb(false) end     -- tab is gone; drop the entry
      raiseChrome(entry, cb)
    end)
end

---------------------------------------------------------------
-- Messages from the extension
---------------------------------------------------------------

local function recordTab(msg, retried)
  -- The CGWindowID of the macOS window hosting this tab. Knowing it is what lets
  -- focushistory suppress the duplicate `window` entry its AX observer would
  -- otherwise record for the same window -- exactly, with no heartbeat and no
  -- "is the extension alive" guesswork.
  local frontmost = hs.application.frontmostApplication()
  if not frontmost or frontmost:name() ~= "Google Chrome" then
    -- The report beat Chrome's activation. Once.
    if not retried then
      hs.timer.doAfter(CGWINDOW_RETRY, function() recordTab(msg, true) end)
    end
    return
  end

  local win = hs.window.focusedWindow()
  local cgWindowId = win and win:id() and tostring(win:id()) or nil

  -- Note the profile this report came from, for `focus-history-extension status`.
  -- Chrome's macOS window title ends in " - <Profile>" when more than one profile
  -- is open, which is the only place the profile name is visible at all: an
  -- extension cannot read it, and every copy shares one extension id.
  --
  -- This is display-only. It is the same kind of title parsing that made the old
  -- tab tracking unreliable, so it is deliberately kept away from anything that
  -- decides what gets recorded or focused -- being wrong here just mislabels a
  -- row in a status listing.
  local title = win and win:title() or ""
  local profile = title:match(" %- ([^%-]+)$")

  -- Key on the extension's clientId when it sends one, otherwise on the profile
  -- name. The fallback matters: clientId is a recent addition, and any copy still
  -- running an older build omits it -- so without this every such profile
  -- collapses into a single row whose profile field is overwritten by whichever
  -- reported last. That is exactly how a Meta profile that was demonstrably
  -- reporting tabs came to be listed only as "Personal".
  local id = msg.clientId and tostring(msg.clientId)
    or ("profile:" .. (profile or "unknown"))

  local client = st.clients[id] or {clientId = id}
  if profile then client.profile = profile end
  if msg.label then client.label = msg.label end
  client.lastTabAt = hs.timer.secondsSinceEpoch()
  st.clients[id] = client

  FocusHistory.record({
    kind = "chrome_tab",
    id = tostring(math.floor(tonumber(msg.tabId))),
    chromeWindowId = tostring(math.floor(tonumber(msg.windowId))),
    cgWindowId = cgWindowId,
    app = "Google Chrome",
    title = msg.title or "",
    url = msg.url or "",
  })
end

local function handleMessage(raw)
  local ok, msg = pcall(hs.json.decode, raw)
  if not ok or type(msg) ~= "table" then return "" end

  if msg.type == "tab" then
    if tonumber(msg.tabId) and tonumber(msg.windowId) then recordTab(msg) end

  elseif msg.type == "hello" then
    -- One record per profile. The copies share an extension id, so clientId (a
    -- uuid the extension keeps in profile-scoped storage) is what distinguishes
    -- them; see the identity() comment in background.js.
    local id = tostring(msg.clientId or "unidentified")
    local client = st.clients[id] or {clientId = id}
    client.label = msg.label or client.label
    client.version = msg.version
    client.seenAt = hs.timer.secondsSinceEpoch()
    st.clients[id] = client
    util.log("chromebridge: extension connected", id, tostring(msg.label))
  end

  return ""
end

---------------------------------------------------------------
-- Setup
---------------------------------------------------------------

function M.setup()
  if _G._ChromeBridgeServer then
    pcall(function() _G._ChromeBridgeServer:stop() end)
    _G._ChromeBridgeServer = nil
  end

  -- Loopback only, and no Bonjour: advertises nothing, unreachable from off the
  -- machine.
  local server = hs.httpserver.new(false, false)
  server:setInterface("localhost")
  server:setPort(PORT)
  server:setCallback(function()
    -- Not part of the protocol, but it makes `curl -s localhost:27123` a usable
    -- "is the bridge up?" check.
    return "focushistory bridge", 200, {}
  end)
  server:websocket(WS_PATH, handleMessage)
  server:start()
  _G._ChromeBridgeServer = server

  FocusHistory.focusHandlers["chrome_tab"] = focusTab
end

-- A profile is present if we've heard anything from it recently. This is inferred
-- purely from inbound traffic because there is no way to ask: hs.httpserver:send()
-- reaches only one client, so a query would poll one profile and silently omit the
-- rest -- which is exactly how a working Meta profile came to be reported as "none
-- connected".
local CLIENT_TTL = 300

function M.status()
  local now = hs.timer.secondsSinceEpoch()
  local clients = {}
  for id, c in pairs(st.clients) do
    local seen = math.max(c.seenAt or 0, c.lastTabAt or 0)
    if (now - seen) <= CLIENT_TTL then
      clients[#clients + 1] = {
        clientId = c.clientId or id,
        -- Explicit label wins over the title-derived profile guess.
        name = c.label or c.profile,
        version = c.version,
        secondsAgo = math.floor(now - seen),
      }
    else
      st.clients[id] = nil
    end
  end
  table.sort(clients, function(a, b)
    return (a.name or a.clientId) < (b.name or b.clientId)
  end)
  return {
    port = PORT,
    running = _G._ChromeBridgeServer ~= nil,
    clientCount = #clients,
    clients = clients,
  }
end

return M
