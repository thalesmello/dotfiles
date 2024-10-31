return {
    'mattboehm/vim-unstack',
    keys = {"<leader>st"},
    cmd = {
        'UnstackFromText',
        'UnstackFromClipboard',
        'UnstackFromSelection',
        'UnstackFromTmux',
    },
    config = function()
        vim.g.unstack_mapkey = "<leader>st"
        vim.g.unstack_populate_quickfix = 1
    end
}
