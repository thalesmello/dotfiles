if vim.fn.match(vim.opt.runtimepath:get(), "vim-textobj-user") == -1 then
   return
end

vim.fn["textobj#user#map"]('python', { class = { ['select-a'] = 'aP', ['select-i'] = 'iP' } })
vim.g.textobj_python_no_default_key_mappings = 1
