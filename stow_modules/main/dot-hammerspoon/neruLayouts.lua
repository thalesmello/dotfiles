-- Neru has one recursive-grid configuration, and native Grid's subgrid is
-- fixed at 3x3. Swap only this marked section to offer both requested layouts.
local M = {}
local first = "# BEGIN NERU MANAGED LAYOUT"
local last = "# END NERU MANAGED LAYOUT"
local layouts = {
  recursive = [[grid_cols = 5
grid_rows = 3
keys = "qwertasdfgzxcvb"
max_depth = 10
layers = [
  { depth = 1, grid_cols = 5, grid_rows = 3, keys = "yuiophjkl;nm,./" },
  { depth = 3, grid_cols = 5, grid_rows = 3, keys = "yuiophjkl;nm,./" },
  { depth = 5, grid_cols = 5, grid_rows = 3, keys = "yuiophjkl;nm,./" },
  { depth = 7, grid_cols = 5, grid_rows = 3, keys = "yuiophjkl;nm,./" },
  { depth = 9, grid_cols = 5, grid_rows = 3, keys = "yuiophjkl;nm,./" },
]
]],
  mouseless = [[grid_cols = 8
grid_rows = 3
keys = "qweruiopasdfjkl;zxcvm,./"
max_depth = 3
layers = [
  { depth = 0, grid_cols = 1, grid_rows = 26, keys = "abcdefghijklmnopqrstuvwxyz" },
  { depth = 1, grid_cols = 26, grid_rows = 1, keys = "abcdefghijklmnopqrstuvwxyz" },
  { depth = 2, grid_cols = 2, grid_rows = 1, keys = "jl" },
  { depth = 3, grid_cols = 8, grid_rows = 3, keys = "qweruiopasdfjkl;zxcvm,./" },
]
]],
}

local function read(path)
  local f, err = io.open(path, "r")
  if not f then return nil, err end
  local text = f:read("*a"); f:close()
  return text
end

function M.replace(text, name)
  if not layouts[name] then return nil, "Unknown Neru layout: " .. tostring(name) end
  local start = text:find(first .. "\n", 1, true)
  local finish = text:find(last, 1, true)
  if not start or not finish or finish <= start or
    text:find(first, start + #first, true) or text:find(last, finish + #last, true) then
    return nil, "Missing or ambiguous managed layout markers in Neru config"
  end
  return text:sub(1, start + #first) .. layouts[name] .. text:sub(finish)
end

function M.current()
  local text = read(os.getenv("HOME") .. "/.config/neru/config.toml")
  if not text then return "recursive" end
  return text:find('keys = "qweruiopasdfjkl;zxcvm,./"', 1, true) and "mouseless" or "recursive"
end

function M.select(name)
  local path = os.getenv("HOME") .. "/.config/neru/config.toml"
  local text, err = read(path)
  if not text then return nil, err end
  local updated, problem = M.replace(text, name)
  if not updated then return nil, problem end
  if updated == text then return false end
  local tmp = path .. ".layout.tmp"
  local f, openErr = io.open(tmp, "w")
  if not f then return nil, openErr end
  local written, writeErr = f:write(updated)
  local closed, closeErr = f:close()
  if not written or not closed then os.remove(tmp); return nil, writeErr or closeErr end
  -- Do not overwrite an editor save that arrived while the file was written.
  if read(path) ~= text then os.remove(tmp); return nil, "Neru config changed during layout selection; try again" end
  local renamed, renameErr = os.rename(tmp, path)
  if not renamed then os.remove(tmp); return nil, renameErr end
  return true
end

return M
