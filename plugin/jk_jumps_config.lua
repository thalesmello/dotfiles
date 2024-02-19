vim.keymap.set("n", "j", function ()
	return vim.v.count > 0 and [[<cmd>call jk_jumps_config#jump('j')<cr>]] or 'gj'
end, { expr = true })

vim.keymap.set("n", "k", function ()
	return vim.v.count > 0 and [[<cmd>call jk_jumps_config#jump('k')<cr>]] or 'gk'
end, { expr = true })
