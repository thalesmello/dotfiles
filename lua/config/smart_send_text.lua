vim.keymap.set({'n', 'x'}, '<Plug>SmartSendOperator', function ()
  if vim.g.neovimterm_last_channel then
    return '<cmd>set opfunc=v:lua.NvimTermWriteOperation<cr>g@'
  elseif vim.env.TMUX then
  else
    return "<cmd>set opfunc=islime2#iTermSendOperator<CR>g@"
  end
end, {noremap = true, silent = true, expr = true})
vim.keymap.set({'n'}, '<Plug>SmartSendNextLine', 'j^', {noremap = true, silent = true})

vim.keymap.set({'n', 'x'}, '<leader><cr>', '<Plug>SmartSendOperator', {remap = true, silent = true})
vim.keymap.set({'n'}, '<leader><cr><cr>', '<Plug>SmartSendOperator_<Plug>SmartSendNextLine', {remap = true, silent = true})
