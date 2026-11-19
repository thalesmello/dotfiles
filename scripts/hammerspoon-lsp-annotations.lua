-- Run with nvim --headless -u NONE -l; no Hammerspoon process/IPC required.
-- Reuse the installed EmmyLua generator with a small editor-side API adapter.
local config = vim.env.HAMMERSPOON_LSP_CONFIGDIR or (vim.env.HOME .. "/.hammerspoon")
local spoonPath = config .. "/Spoons/EmmyLua.spoon/"
local docs = "/Applications/Hammerspoon.app/Contents/Resources/docs.json"
if not vim.uv.fs_stat(docs) then return end
local function split(str, pattern)
  local result, pos = {}, 1
  while true do
    local first, last = str:find(pattern, pos)
    if not first then result[#result + 1] = str:sub(pos); return result end
    result[#result + 1] = str:sub(pos, first - 1)
    pos = last + 1
  end
end
local function readJson(path)
  local fd = io.open(path)
  if not fd then return nil end
  local data = fd:read("*a"); fd:close()
  local ok, value = pcall(vim.json.decode, data)
  return ok and value or nil
end
local noop = function() end
local adapter = {
  configdir = config,
  docstrings_json_file = docs,
  inspect = vim.inspect,
  logger = {new = function() return {i = noop, d = noop} end},
  fs = {
    mkdir = function(path) vim.fn.mkdir(path, "p") end,
    attributes = function(path, key)
      local stat = vim.uv.fs_stat(path)
      if not stat then return nil end
      if key == "modification" then return stat.mtime.sec end
      error("unsupported attribute: " .. tostring(key))
    end,
  },
  json = {
    read = readJson,
    write = function(value, path)
      local fd = assert(io.open(path, "w"))
      fd:write(vim.json.encode(value)); fd:close()
    end,
  },
  fnutils = {split = split},
  spoons = {
    resourcePath = function(name) return spoonPath .. name end,
    scriptPath = function() return spoonPath end,
    list = function()
      local result = {}
      for _, path in ipairs(vim.fn.glob(config .. "/Spoons/*.spoon", false, true)) do
        result[#result + 1] = {name = path:match("([^/]+)%.spoon$")}
      end
      return result
    end,
  },
}
local env = setmetatable({hs = adapter}, {__index = _G})
local generator = assert(loadfile(spoonPath .. "init.lua", "t", env))()
local output = io.output()
local ok, err = pcall(function() generator:init() end)
io.output(output)
if not ok then error(err) end
