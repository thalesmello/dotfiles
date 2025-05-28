return {
    'mattboehm/vim-unstack',
    keys = {"<leader>sT"},
    cmd = {
        'UnstackFromText',
        'UnstackFromClipboard',
        'UnstackFromSelection',
        'UnstackFromTmux',
    },
    config = function()
        vim.g.unstack_mapkey = "<leader>sT"
        vim.g.unstack_populate_quickfix = 1
    end
}
