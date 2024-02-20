local function smart_jump(key)
	if vim.v.count > 0 then
		vim.cmd("normal! " .. vim.v.count1 .. key)

		if vim.v.count1 >= 7 then
			local target = vim.fn.line('.')
			local bkey = (key == 'k') and 'j' or 'k'

			vim.cmd("normal! " .. vim.v.count1 .. bkey)
			vim.cmd("normal! " .. target .. "G")
		end
	else
		vim.api.nvim_feedkeys("g" .. key, "n", false)
	end
end

vim.keymap.set("n", "j", function ()
	smart_jump("j")
end)

vim.keymap.set("n", "k", function ()
	smart_jump("k")
end)
