if not vim.g.neovide then
	return
end

vim.keymap.set({"n", "v", "t"}, "<D-d>", "<C-Space>v", { remap = true })
vim.keymap.set({"n", "v", "t"}, "<D-D>", "<C-Space>\"", { remap = true })
vim.keymap.set({"n", "v", "t"}, "<D-p>", "<c-t>", { remap = true })
vim.keymap.set({"n", "v", "t"}, "<D-w>", "<leader><bs>", { remap = true })
