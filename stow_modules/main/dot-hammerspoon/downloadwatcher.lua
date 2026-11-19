local shell = require("shell")
local util = require("util")
local Preset = require("preset")

local M = {}

-- Extensions used for in-progress downloads; ignored until the browser renames
-- the file to its final name (which then registers as a fresh add).
local TEMP_EXTENSIONS = {
  crdownload = true, -- Chrome
  download = true,   -- Safari
  part = true,       -- Firefox / others
  partial = true,
}

-- Human-readable size, e.g. 1536 -> "1.5 KB", 1048576 -> "1 MB".
local function humanSize(bytes)
  local units = {"B", "KB", "MB", "GB", "TB"}
  local size, i = bytes, 1
  while size >= 1024 and i < #units do
    size = size / 1024
    i = i + 1
  end
  if i == 1 then
    return string.format("%d %s", size, units[i])
  end
  -- Trim a trailing ".0" so whole numbers read as "1 MB", not "1.0 MB".
  return (string.format("%.1f", size):gsub("%.0$", "")) .. " " .. units[i]
end

-- Newest finished, visible top-level file in `dir`, by creation time. Skips
-- hidden files (.DS_Store), partial downloads, and folders. Non-recursive by
-- design. Returns name, attrs (or nil when the folder has no eligible file).
local function newestFile(dir, initialNames)
  local newestName, newestAttrs
  for entry in hs.fs.dir(dir) do
    if entry ~= "." and entry ~= ".." and entry:sub(1, 1) ~= "."
        and (not initialNames or initialNames[entry]) then
      local ext = entry:match("%.([^.]+)$")
      if not (ext and TEMP_EXTENSIONS[ext:lower()]) then
        local attrs = hs.fs.attributes(dir .. "/" .. entry)
        if attrs and attrs.mode == "file"
            and (not newestAttrs or attrs.creation > newestAttrs.creation) then
          newestName, newestAttrs = entry, attrs
        end
      end
    end
  end
  return newestName, newestAttrs
end

function M.setup()
  local dir = hs.fs.pathToAbsolute(os.getenv("HOME") .. "/Downloads")
  if not dir then return end

  if _G.DownloadWatcher then _G.DownloadWatcher:stop() end
  if _G.DownloadWatcherBootstrap then _G.DownloadWatcherBootstrap:stop() end

  -- Snapshot names only (no stat calls) before yielding. The expensive metadata
  -- baseline is lazy, but must not include downloads arriving during the gap.
  local initialNames = {}
  for entry in hs.fs.dir(dir) do initialNames[entry] = true end
  local initialized, pending = false, false
  local lastCreation = 0
  local function onChange()
    if not initialized then pending = true; return end
    local name, attrs = newestFile(dir)
    -- Nothing new: no eligible file, or the newest one predates the last copy.
    if not attrs or attrs.creation <= lastCreation then return end
    lastCreation = attrs.creation

    local path = dir .. "/" .. name
    shell.task({"bincopy", path}, function(ok)
      if ok then
        Preset.displayMessage("Copied " .. name .. " (" .. humanSize(attrs.size) .. ")", 1.5)
      else
        util.log("bincopy failed for", path)
      end
    end)
  end

  local watcher = hs.pathwatcher.new(dir, onChange)
  if watcher then
    watcher:start()
    _G.DownloadWatcher = watcher
    _G.DownloadWatcherBootstrap = hs.timer.doAfter(0, function()
      if _G.DownloadWatcher ~= watcher then return end
      _G.DownloadWatcherBootstrap = nil
      local _, seed = newestFile(dir, initialNames)
      lastCreation = seed and seed.creation or 0
      initialNames = nil
      initialized = true
      if pending then onChange() end
    end)
  end
end

return M
