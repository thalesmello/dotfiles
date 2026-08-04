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
      local luaFiles = hs.fnutils.filter(files, function(f)
        -- Only real .lua files. Skip atomic-save temp files (basenames like
        -- ".!35838!ghosttyPreset.lua" or editor swap/hidden files): they end in
        -- .lua but start with "." and vanish before we can load them, which
        -- otherwise gets misreported as a syntax error.
        local base = f:match("[^/]+$") or f
        return f:match("%.lua$") and base:sub(1, 1) ~= "."
      end)
      if not luaFiles or #luaFiles == 0 then return end

      for _, file in ipairs(luaFiles) do
        -- The file may have been removed between the fs event and now (renames,
        -- deletes); that's not a syntax error, so skip it rather than alerting.
        if hs.fs.attributes(file) then
          local fn, err = loadfile(file)
          if not fn then
            util.log("Syntax error in " .. file .. ": " .. err)
            hs.alert.show("Syntax error in " .. file:match("[^/]+$"))
            return
          end
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
