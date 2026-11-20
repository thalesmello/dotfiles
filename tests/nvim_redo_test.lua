-- Run: nvim --headless -u NONE -l tests/nvim_redo_test.lua
local root = vim.fn.fnamemodify(debug.getinfo(1, "S").source:sub(2), ":p:h:h")
dofile(root .. "/stow_modules/main/dot-config/nvim/lua/config/mappings.lua")
local function keys(text)
  vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes(text, true, false, true), "xt", false)
end
local function text() return table.concat(vim.api.nvim_buf_get_lines(0, 0, -1, false), "\n") end
for _, mode in ipairs({ "n", "x", "i" }) do
  local mapping = vim.fn.maparg("<C-S-/>", mode, false, true)
  assert(mapping.desc == "Redo", mode .. " has redo mapping")
end
assert(vim.fn.keytrans(vim.api.nvim_replace_termcodes("<C-S-/>", true, false, true)) == "<C-S-/>")
-- Normal, visual, and insert modes all redo the native undo tree.
for _, prefix in ipairs({ "", "v", "i" }) do
  vim.cmd.enew()
  keys("iabc<Esc>")
  assert(text() == "abc")
  keys("<C-_>")
  assert(text() == "")
  keys(prefix .. "<C-S-/>")
  assert(text() == "abc", "redo works from " .. prefix)
  keys("<Esc><C-_>")
  assert(text() == "", "redo remains undoable")
end
print("Neovim redo mappings OK")
