local home = os.getenv("HOME")
local local_dotfiles = home .. "/.local_dotfiles"
local util = require('util')

package.path = local_dotfiles .. "/hammerspoon/?.lua;"
    .. local_dotfiles .. "/hammerspoon/?/init.lua;"
    .. package.path

require("hs.ipc")

if not hs.ipc.cliStatus(nil, true) then
  hs.ipc.cliInstall()
end

require("keybindings").setup()
require("audiodevice").setup()
require("filewatcher").setup()
require("downloadwatcher").setup()
require("missioncontrol").setup()
require("debuglog").setup()

hs.loadSpoon("EmmyLua")

hs.console.darkMode(true)

util.notify("Hammerspoon!")

