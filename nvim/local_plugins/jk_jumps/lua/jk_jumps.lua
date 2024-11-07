local vim_utils = require "vim_utils"
local function smart_jump(key)
	if vim.v.count > 0 or vim.fn.reg_recording() ~= '' then
		vim.cmd("normal! " .. vim.v.count1 .. key)

		if vim.v.count1 >= 7 then
			local target = vim.fn.line('.')
			local bkey = (key == 'k') and 'j' or 'k'

			vim.cmd("normal! " .. vim.v.count1 .. bkey)
			vim.cmd("normal! " .. target .. "G")
		end
	else
		vim_utils.feedkeys("g" .. key)
	end
end

vim.keymap.set("n", "j", function ()
	smart_jump("j")
end, { silent = true })

vim.keymap.set("n", "k", function ()
	smart_jump("k")
end, { silent = true })
