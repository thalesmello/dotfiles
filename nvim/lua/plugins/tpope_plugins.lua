return {
    { 'tpope/vim-eunuch', event = 'VeryLazy'},
    {
        'tpope/vim-repeat',
        extra_contexts = {"vscode", "firenvim"}
    },
    { 'tpope/vim-abolish', keys = {"cr"}, cmd = {"Abolish", "Subvert", "S"}},
    {
        'tpope/vim-sleuth',
        event = { "BufReadPost", "BufNewFile", "BufFilePost" },
    },
    {
        'tpope/vim-rsi',
        event = {"CmdlineEnter", "InsertEnter"},
        extra_contexts = {"vscode", "firenvim"}
    },
    {
        'tpope/vim-unimpaired',
        event = "VeryLazy",
        extra_contexts = {"firenvim"}
    },
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
        extra_contexts = {"firenvim"}
    }
}
