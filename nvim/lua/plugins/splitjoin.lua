return {
    {
        'AndrewRadev/splitjoin.vim',
        init = function()
            require('config/splitjoin')
        end,
        vscode = true,
        firenvim = true,
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
        vscode = true,
        firenvim = true,
    },
}
