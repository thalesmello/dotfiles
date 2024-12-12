return {
    {
        'AndrewRadev/splitjoin.vim',
        init = function()
            vim.g.splitjoin_python_brackets_on_separate_lines = 1
            vim.g.splitjoin_split_mapping = ''
            vim.g.splitjoin_join_mapping = ''

            vim.keymap.set('n', '<leader>gS', '<Cmd>SplitjoinSplit<CR>', { silent = true, desc = "Split structure" })
            vim.keymap.set('n', '<leader>gJ', '<Cmd>SplitjoinJoin<CR>', { silent = true, desc = "Join structure" })
        end,
        extra_contexts = {"vscode", "firenvim"}
    },
    {
        'Wansmer/treesj',
        dependencies = {
            'nvim-treesitter/nvim-treesitter',
            'AndrewRadev/splitjoin.vim',
        },
        config = function()
            require('config/treesj')
        end,
        keys = { "gS", "gJ" },
        cmd = {"TSJSplit", "TSJJoin"},
        extra_contexts = {"vscode", "firenvim"}
    },
}
