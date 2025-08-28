if not vim.g.neovide then
	return
end

vim.g.neovide_input_macos_option_key_is_meta = 'only_left'

vim.keymap.set({"n", "v", "t"}, "<D-c>", '"+ygv', { remap = false })
vim.keymap.set({"n", "v", "t"}, "<D-v>", '"+yp', { remap = false })
vim.keymap.set({"i"}, "<D-v>", "<c-r><c-r>+", { remap = false })
vim.keymap.set({"n", "v", "t"}, "<D-d>", "<C-Space>v", { remap = true })
vim.keymap.set({"n", "v", "t"}, "<D-D>", "<C-Space>\"", { remap = true })
vim.keymap.set({"n", "v", "t"}, "<D-p>", "<c-t>", { remap = true })
vim.keymap.set({"n", "v", "t"}, "<D-w>", "<leader><bs>", { remap = true })
vim.keymap.set({"n", "v", "t"}, "<M-D-Right>", "<C-Right>", { remap = true })
vim.keymap.set({"n", "v", "t"}, "<M-D-Left>", "<C-Left>", { remap = true })
vim.keymap.set({"n", "v", "t"}, "<M-D-Down>", "<C-Down>", { remap = true })
vim.keymap.set({"n", "v", "t"}, "<M-D-Up>", "<C-Up>", { remap =  true  })
