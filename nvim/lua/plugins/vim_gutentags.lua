return {
    'ludovicchabant/vim-gutentags',
    init = function()
        vim.g.gutentags_ctags_exclude = { 'node_modules', '.git' }
    end,
}
