return {
    'tpope/vim-endwise',
    dependencies = {
        -- Run autopairs before endwise so both of them work get to hook <cr> in insert mode
        {"windwp/nvim-autopairs"}
    },
    firenvim = true,
    vscode = true,
}
