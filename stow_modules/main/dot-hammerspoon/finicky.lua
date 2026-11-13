-- Finicky, reimplemented on top of hs.urlevent.
--
-- Port of dotfiles/stow_modules/main/dot-finicky.js: every http(s) link opened
-- by any app is routed to a Chrome profile, preset app, or another app based on
-- the URL's host and on which app asked for it. Generic routing rules (such as
-- WhatsApp wa.me links) live here; machine/work-specific rules live in
-- local/finicky.lua and override M.handlers.
--
-- Hammerspoon only receives URLs it is the system handler for. Run the
-- "Install Hammerspoon as Default Browser" palette command once -- on current
-- macOS that means picking Hammerspoon in the System Settings pane it opens,
-- since LaunchServices no longer lets an app claim http/https on its own.
-- "Restore Chrome as Default Browser" hands it back.
--
-- Not ported: the `slack:` handler. macOS only lets an app declare the schemes
-- in its Info.plist, and Hammerspoon declares `hammerspoon:` plus http/https,
-- so a `slack:` URL can never reach this code -- Slack.app stays the system
-- handler for it, which is what that rule wanted anyway.

local shell = require("shell")
local util = require("util")

local task = shell.task

local M = {}

local CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

local DEFAULT_PROFILE = "Default"
local WHATSAPP_WEBSITES = {"wa.me"}

-- Where URLs go when no rule matches: Chrome, whichever profile it feels like.
M.defaultBrowser = {chromeProfile = nil}
M.WHATSAPP_WEBSITES = WHATSAPP_WEBSITES

---------------------------------------------------------------
-- Targets
---------------------------------------------------------------

-- Launching the Chrome binary directly (rather than `open -a`) is what makes
-- --profile-directory work: `open` drops --args entirely when the app is
-- already running, while a second invocation of the binary hands the URL to the
-- running instance through Chrome's singleton lock, profile flag included.
local function openInChrome(url, profile)
  local args = {CHROME_BIN}
  if profile then args[#args + 1] = "--profile-directory=" .. profile end
  args[#args + 1] = url
  task(args)
end

local function openInApp(url, appPath)
  task({"open", "-a", appPath, url})
end

local function openInPresetApp(url, appName, profile, callback)
  local args = {"chrome-preset", "open-in-app", "--if-open"}
  if profile then
    args[#args + 1] = "--profile"
    args[#args + 1] = profile
  end
  args[#args + 1] = appName
  args[#args + 1] = url
  task(args, callback)
end

local function chromeProfile(profile)
  return {chromeProfile = profile}
end

-- Rewrite a `wa.me` link to the direct WhatsApp Web `/send/` URL so it opens
-- the conversation inside WhatsApp Web instead of landing on `api.whatsapp.com`
-- and prompting for the native desktop app:
--   https://wa.me/XXXXXXXXXXX            -> https://web.whatsapp.com/send/?phone=XXXXXXXXXXX
--   https://wa.me/+XXXXXXXXXXX?text=hi   -> https://web.whatsapp.com/send/?phone=XXXXXXXXXXX&text=hi
--   https://wa.me/send/?phone=XXXXXXXXXXX -> https://web.whatsapp.com/send/?phone=XXXXXXXXXXX
local function whatsappWebUrl(url)
  local pathAndQuery = url:match("^https?://[^/]*wa%.me/?(.*)$")
  if not pathAndQuery then return url end

  local path, query = pathAndQuery:match("^([^?#]*)%?(.*)$")
  if not path then path = pathAndQuery:match("^([^#]*)") or pathAndQuery end
  path = path:gsub("^/+", ""):gsub("/+$", "")

  if path == "" or path:lower() == "send" then
    if query and query ~= "" then
      return "https://web.whatsapp.com/send/?" .. query
    end
    return "https://web.whatsapp.com/"
  end

  local phone = path:gsub("^%+", "")
  if query and query ~= "" then
    return "https://web.whatsapp.com/send/?phone=" .. phone .. "&" .. query
  end
  return "https://web.whatsapp.com/send/?phone=" .. phone
end

local function presetApp(appName, profile, transformUrl)
  return {presetApp = appName, chromeProfile = profile, transformUrl = transformUrl}
end

local function app(appPath)
  return {app = appPath}
end

local function openWith(target, url)
  if target.app then
    openInApp(url, target.app)
  else
    openInChrome(url, target.chromeProfile)
  end
end

M.chromeProfile = chromeProfile
M.presetApp = presetApp
M.app = app
M.whatsappWebUrl = whatsappWebUrl

---------------------------------------------------------------
-- Matchers
---------------------------------------------------------------

local function contains(list, value)
  for _, item in ipairs(list) do
    if item == value then return true end
  end
  return false
end

-- Finicky's `url.host.endsWith(website)`: matches the domain itself and any
-- subdomain of it.
local function hostMatches(host, websites)
  if not host then return false end
  host = host:lower()
  for _, website in ipairs(websites) do
    if host == website or host:sub(-(#website + 1)) == "." .. website then
      return true
    end
  end
  return false
end

local function hostIn(websites)
  return function(req) return hostMatches(req.host, websites) end
end

local function openerIn(apps)
  return function(req) return req.opener ~= nil and contains(apps, req.opener) end
end

M.hostMatches = hostMatches
M.hostIn = hostIn
M.openerIn = openerIn

---------------------------------------------------------------
-- Handlers, in priority order
---------------------------------------------------------------

M.handlers = {
  {match = hostIn(WHATSAPP_WEBSITES), target = presetApp("WhatsApp", DEFAULT_PROFILE, whatsappWebUrl)},
}

---------------------------------------------------------------
-- Routing
---------------------------------------------------------------

-- Name of the app that asked for the URL. senderPID is -1 when macOS didn't
-- say; the frontmost app is the best guess left, and it is right for the common
-- case of clicking a link in the app you are looking at.
local function openerName(senderPID)
  local sender = senderPID and senderPID > 0 and hs.application.applicationForPID(senderPID)
  if not sender then sender = hs.application.frontmostApplication() end
  return sender and sender:name() or nil
end

function M.route(url, host, senderPID)
  local req = {url = url, host = host, opener = openerName(senderPID)}

  local function routeFrom(startIdx)
    for i = startIdx, #M.handlers do
      local handler = M.handlers[i]
      if handler.match(req) then
        if handler.target.presetApp then
          local presetUrl = handler.target.transformUrl and handler.target.transformUrl(url) or url
          util.log("finicky: trying preset app", handler.target.presetApp, "for", presetUrl, "from", req.opener or "?")
          openInPresetApp(presetUrl, handler.target.presetApp, handler.target.chromeProfile, function(ok)
            if not ok then
              util.log("finicky: preset app", handler.target.presetApp, "not open; falling back for", url)
              routeFrom(i + 1)
            end
          end)
          return
        end

        util.log("finicky: routing", url, "from", req.opener or "?", "->",
          handler.target.app or handler.target.chromeProfile)
        openWith(handler.target, url)
        return
      end
    end

    util.log("finicky: no rule for", url, "from", req.opener or "?", "-> default")
    openWith(M.defaultBrowser, url)
  end

  routeFrom(1)
end

---------------------------------------------------------------
-- Local overrides & setup
---------------------------------------------------------------

local function applyLocalConfig()
  local ok, localConfig = pcall(require, "local.finicky")
  if ok and localConfig and localConfig.setup then
    localConfig.setup(M)
  end
end

applyLocalConfig()

-- Installing the callback is all there is to it: becoming the system handler is
-- the "Install Hammerspoon as Default Browser" palette command's job (main
-- keybindings.lua), since that part is not work-machine specific.
function M.setup()
  applyLocalConfig()
  hs.urlevent.httpCallback = function(_scheme, host, _params, fullURL, senderPID)
    M.route(fullURL, host, senderPID)
  end
end

return M
