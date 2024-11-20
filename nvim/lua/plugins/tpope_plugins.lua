return {
    { 'tpope/vim-eunuch', event = 'VeryLazy'},
    { 'tpope/vim-repeat', firenvim = true, vscode = true },
    { 'tpope/vim-abolish', keys = {"cr"}, cmd = {"Abolish", "Subvert"}},
    {
        'tpope/vim-sleuth',
        event = { "BufReadPost", "BufNewFile", "BufFilePost" },
    },
    { 'tpope/vim-rsi', event = {"CmdlineEnter", "InsertEnter"}, firenvim = true, vscode = true },
    { 'tpope/vim-unimpaired', event = "VeryLazy", firenvim = true },
    {
        'tpope/vim-apathy',
        ft = {
            'c',
            'coffee',
            'csh',
            'desktop',
            'dosbatch',
            'go',
            'javascript',
            'javascriptreact',
            'lua',
            'python',
            'ruby',
            'scheme',
            'sh',
            'typescript',
            'typescriptreact',
            'zsh',
        }
    },
    {
        'tpope/vim-scriptease',
        keys = {},
        ft = {"vim", "help"},
        cmd = {
            "Messages",
            "PP",
            "Scriptnames",
            "Verbose",
        },
        firenvim = true,
    }
}
