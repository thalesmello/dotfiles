if not vim.env.TMUX then
    return
end

function WriteOperation()
    vim.fn.setpos("'<", vim.fn.getpos("'["))
    vim.fn.setpos("'>", vim.fn.getpos("']"))
    vim.cmd([[normal! gv]])

    vim.cmd([['<,'>Twrite {last}]])
    vim.cmd([[normal! '<j^]])
end

vim.api.nvim_set_keymap('n', '<leader><cr>', '<cmd>set opfunc=v:lua.WriteOperation()<cr>g@', {noremap = true, silent = true})
vim.api.nvim_set_keymap('x', '<leader><cr>', '<cmd>set opfunc=v:lua.WriteOperation()<cr>g@', {noremap = true, silent = true})
vim.api.nvim_set_keymap('n', '<leader><cr><cr>', 'V<cmd>set opfunc=v:lua.WriteOperation()<cr>g@', {noremap = true, silent = true})

vim.api.nvim_create_user_command("TmuxEnter", function (opts)
	vim.cmd.Tmux("send", "-t", "{last}", vim.fn.shellescape(opts.args), "Enter")
end, {
	nargs = "+",
})

