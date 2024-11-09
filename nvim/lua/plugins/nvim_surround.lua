return {
    'kylechui/nvim-surround',
    dependencies = {
        'nvim-treesitter/nvim-treesitter',
        'kana/vim-textobj-user',
    },
    config = function() require('config/surround') end,
    cond = false,
    vscode = true,
    firenvim = true,
}
