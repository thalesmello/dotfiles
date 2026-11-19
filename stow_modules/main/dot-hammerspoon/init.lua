local startupStarted = hs.timer.absoluteTime()
local startupTiming = require("startupTiming")
local startup = startupTiming.begin(startupStarted)
-- Routine hotkey enable/override messages produce >100 console lines per reload.
-- Keep warnings/errors; opt into verbose diagnostics through this setting.
hs.hotkey.setLogLevel(hs.settings.get("hammerspoon.hotkeyLogLevel") or "warning")
local home = os.getenv("HOME")
local local_dotfiles = home .. "/.local_dotfiles"

package.path = local_dotfiles .. "/hammerspoon/?.lua;"
    .. local_dotfiles .. "/hammerspoon/?/init.lua;"
    .. package.path

-- Opens the mach port that `hs -c` talks to. Installing the `hs` binary itself
-- is deliberately NOT done here: cliStatus+cliInstall cost ~116ms of a ~210ms
-- load and, with the default /usr/local prefix (root-owned, and not where
-- Homebrew lives on Apple Silicon), silently failed and re-ran every reload.
-- Use the "Install Hammerspoon CLI" command in the palette instead.
require("hs.ipc")

require("keybindings").setup()
require("finicky").setup()
require("herdrRelay").setup()
require("audiodevice").setup()
require("filewatcher").setup()
require("gokuWatcher").setup()
require("downloadwatcher").setup()
require("zoomwatcher").setup()
require("totwatcher").setup()
require("missioncontrol").setup()
require("debuglog").setup()
require("workflowPreset").setup()
require("herdrFocus").setup()

-- Editor annotations are generated only by the Lua LSP hook (see
-- bin/hammerspoon-lsp-annotations), never during runtime startup.

hs.loadSpoon("HoldToQuit")
spoon.HoldToQuit.duration = 1
spoon.HoldToQuit:init()
spoon.HoldToQuit:start()

hs.console.darkMode(true)

-- This is a ready acknowledgement, not a loading animation. Leave other
-- alerts unchanged and make only this notification instant and brief.
hs.alert.show("Hammerspoon!", {fadeInDuration = 0, fadeOutDuration = 0.05}, 0.5)

-- Includes deferred bootstrap work and, for tracked reloads, the engine
-- teardown/reinitialization time before init.lua began.
startupTiming.finish(startup, startupStarted)
