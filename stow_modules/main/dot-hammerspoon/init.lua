local startupStarted = hs.timer.absoluteTime()
local home = os.getenv("HOME")
local local_dotfiles = home .. "/.local_dotfiles"
local util = require('util')

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
require("downloadwatcher").setup()
require("zoomwatcher").setup()
require("totwatcher").setup()
require("missioncontrol").setup()
require("debuglog").setup()
require("workflowPreset").setup()

-- Editor annotations are generated only by the Lua LSP hook (see
-- bin/hammerspoon-lsp-annotations), never during runtime startup.

hs.loadSpoon("HoldToQuit")
spoon.HoldToQuit.duration = 1
spoon.HoldToQuit:init()
spoon.HoldToQuit:start()

hs.console.darkMode(true)

util.notify("Hammerspoon!")

-- Keep real reload timings available via the console/CLI, including deferred
-- bootstrap work that runs before the first post-init event-loop marker.
_G.HammerspoonStartup = {initMs = (hs.timer.absoluteTime() - startupStarted) / 1e6}
local startup = _G.HammerspoonStartup
startup.timer = hs.timer.doAfter(0, function()
  startup.timer = nil
  startup.firstEventLoopMs = (hs.timer.absoluteTime() - startupStarted) / 1e6
  print(string.format("Startup: init %.1f ms; first event loop %.1f ms",
    startup.initMs, startup.firstEventLoopMs))
end)
