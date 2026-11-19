-- Offline only: resolve paths without launching apps or shell commands.
package.loaded.async = {wrap = function(fn) return fn end}
package.loaded.util = {log = function() end}
local localNeru = os.getenv("HOME") .. "/.local/bin/neru"
local files = {}
_G.hs = {
  task = {new = function() return {environment = function() return {PATH = "/opt/homebrew/bin"} end} end},
  settings = {get = function() return nil end},
  fs = {attributes = function(path) return files[path] and "file" or nil end},
}
local function resolver() return dofile("stow_modules/main/dot-hammerspoon/shell.lua") end
files[localNeru] = true
files["/opt/homebrew/bin/neru"] = true
assert(resolver().resolvePath("neru") == localNeru, "local CLI must match Neru.app daemon")
files[localNeru] = nil
assert(resolver().resolvePath("neru") == "/opt/homebrew/bin/neru", "fallback must work without local build")
files["/opt/homebrew/bin/hs"] = true
assert(resolver().resolvePath("hs") == "/opt/homebrew/bin/hs", "other binaries retain PATH lookup")
assert(resolver().resolvePath("/explicit/neru") == "/explicit/neru", "explicit paths remain unchanged")
print("4 binary-resolution tests, 0 failures")
