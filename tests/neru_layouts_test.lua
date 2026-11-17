local layouts = dofile("stow_modules/main/dot-hammerspoon/neruLayouts.lua")
local file = assert(io.open("stow_modules/main/dot-config/neru/config.toml", "r"))
local original = file:read("*a"); file:close()
local classic = assert(layouts.replace(original, "mouseless"))
assert(classic:find('keys = "qweruiopasdfjkl;zxcvm,./"', 1, true))
for _, shape in ipairs({"grid_cols = 1, grid_rows = 26", "grid_cols = 26, grid_rows = 1",
  "grid_cols = 2, grid_rows = 1", "grid_cols = 8, grid_rows = 3"}) do assert(classic:find(shape, 1, true)) end
local recursive = assert(layouts.replace(classic, "recursive"))
assert(recursive:find('keys = "qwertasdfgzxcvb"', 1, true))
for _, depth in ipairs({1, 3, 5, 7, 9}) do
  assert(recursive:find('depth = ' .. depth .. ', grid_cols = 5, grid_rows = 3, keys = "yuiophjkl;nm,./"', 1, true))
end
assert(layouts.replace(recursive, "recursive") == recursive)
local function outside(text)
  return (text:gsub("# BEGIN NERU MANAGED LAYOUT.-# END NERU MANAGED LAYOUT", "<layout>"))
end
assert(outside(classic) == outside(original), "Mouseless preset changed non-layout settings")
assert(outside(recursive) == outside(original), "Alternating-hand preset changed non-layout settings")
assert(layouts.replace(original, "unknown") == nil)
assert(layouts.replace("no markers", "recursive") == nil)
assert(layouts.replace(original .. "\n# BEGIN NERU MANAGED LAYOUT\n", "recursive") == nil)
print("Neru layout preset tests passed")
