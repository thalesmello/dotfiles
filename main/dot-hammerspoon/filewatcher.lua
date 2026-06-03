local util = require("util")

local M = {}

function M.setup()
  local function resolvePath(path)
    return hs.fs.pathToAbsolute(path) or path
  end

  local watchPaths = {
    resolvePath(os.getenv("HOME") .. "/.hammerspoon"),
    resolvePath(os.getenv("HOME") .. "/.local_dotfiles/hammerspoon"),
  }

  _G.ReloadFileListeners = {}
  for _, path in ipairs(watchPaths) do
    local watcher = hs.pathwatcher.new(path, function(files)
      local luaFiles = hs.fnutils.filter(files, function(f) return f:match("%.lua$") end)
      if not luaFiles or #luaFiles == 0 then return end

      for _, file in ipairs(luaFiles) do
        local fn, err = loadfile(file)
        if not fn then
          util.log("Syntax error in " .. file .. ": " .. err)
          hs.alert.show("Syntax error in " .. file:match("[^/]+$"))
          return
        end
      end

      util.log("Reloading config")
      hs.reload()
    end)
    if watcher then
      watcher:start()
      table.insert(ReloadFileListeners, watcher)
    end
  end
end

return M
