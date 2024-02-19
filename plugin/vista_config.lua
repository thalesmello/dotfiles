vim.g.vista_icon_indent = { "╰─▸ ", "├─▸ " }
vim.g["vista#renderer#enable_icon"] = 1
vim.g.vista_default_executive = 'ctags'

vim.keymap.set("n", "<leader>co", '<cmd>Vista!!<cr>', { remap = true })

local group = vim.api.nvim_create_augroup("VistaAutoGroup", {
  clear = true
})

vim.api.nvim_create_autocmd({ 'FileType' }, {
  group = group,
  pattern = 'python',
  callback = function()
    vim.keymap.set('n', 'gS', '<Cmd>TSJSplit<CR>', { buffer = true, silent = true })
  end,
})
