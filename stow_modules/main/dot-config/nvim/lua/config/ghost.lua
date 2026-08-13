if vim.env.NVIM_GHOST_ENABLE ~= "1" then
	return
end

-- The ghost instance is anchored to an empty scratch dir (see bin/neovim-ghost),
-- and every file arrives in its own tab from an unrelated project. Give each new
-- tab a local cwd at the project root of whatever file opened it, so tab-local
-- tools (fzf, terminals, dispatch) work on that project instead of the scratch dir.
vim.api.nvim_create_autocmd("TabNewEntered", {
	group = vim.api.nvim_create_augroup("GhostTabProjectRoot", { clear = true }),
	callback = function()
		-- Only tabs opened on a real file, and never override an explicit :tcd.
		if vim.bo.buftype ~= "" or vim.api.nvim_buf_get_name(0) == "" then
			return
		end

		if vim.fn.haslocaldir(-1, 0) == 1 then
			return
		end

		require("vim_utils").tcd_project_root()
	end,
})
