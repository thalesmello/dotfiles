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
require("audiodevice").setup()
require("filewatcher").setup()
require("downloadwatcher").setup()
require("missioncontrol").setup()
require("debuglog").setup()
require("workflowPreset").setup()

hs.loadSpoon("EmmyLua")

hs.loadSpoon("HoldToQuit")
spoon.HoldToQuit.duration = 1
spoon.HoldToQuit:init()
spoon.HoldToQuit:start()

hs.console.darkMode(true)

util.notify("Hammerspoon!")
