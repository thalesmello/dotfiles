if not vim.g.neovide then
	return
end

vim.g.neovide_input_macos_option_key_is_meta = 'only_left'

vim.keymap.set({"v"}, "<D-c>", '"+ygv', { remap = false })
vim.keymap.set({"n", "v"}, "<D-v>", '"+p', { remap = false })
vim.keymap.set({"i", "c"}, "<D-v>", "<c-r><c-r>+", { remap = false })
vim.keymap.set({"t"}, "<D-v>", '<c-\\><c-n>"+pi', { remap = false })
vim.keymap.set({"n", "v", "t"}, "<D-d>", "<C-Space>v", { remap = true })
vim.keymap.set({"n", "v", "t"}, "<D-D>", "<C-Space>\"", { remap = true })
vim.keymap.set({"n", "v", "t"}, "<D-p>", "<c-t>", { remap = true })
vim.keymap.set({"n", "v", "t"}, "<D-w>", "<leader><bs>", { remap = true })
vim.keymap.set({"n", "v", "t"}, "<M-D-Right>", "<c-\\><c-n><C-l>", { remap = true })
vim.keymap.set({"n", "v", "t"}, "<M-D-Left>", "<c-\\><c-n><C-h>", { remap = true })
vim.keymap.set({"n", "v", "t"}, "<M-D-Down>", "<c-\\><c-n><C-j>", { remap = true })
vim.keymap.set({"n", "v", "t"}, "<M-D-Up>", "<c-\\><c-n><C-k>", { remap =  true  })
vim.keymap.set({"n", "v", "t"}, "<D-{>", "<c-\\><c-n>gT", { remap = false })
vim.keymap.set({"n", "v", "t"}, "<D-}>", "<c-\\><c-n>gt", { remap = false })
