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
local function newestFile(dir)
  local newestName, newestAttrs
  for entry in hs.fs.dir(dir) do
    if entry ~= "." and entry ~= ".." and entry:sub(1, 1) ~= "." then
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

  -- Track the newest creation time seen so only files created from now on copy.
  local _, seed = newestFile(dir)
  local lastCreation = seed and seed.creation or 0

  local watcher = hs.pathwatcher.new(dir, function()
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
  end)

  if watcher then
    watcher:start()
    _G.DownloadWatcher = watcher
  end
end

return M
