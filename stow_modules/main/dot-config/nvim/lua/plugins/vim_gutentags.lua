return {
    'ludovicchabant/vim-gutentags',
    event = { "BufReadPost", "BufNewFile", "BufFilePost" },
    init = function()
        vim.g.gutentags_ctags_exclude = { 'node_modules', '.git' }
    end,
}
