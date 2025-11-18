return {
    {
        'tpope/vim-eunuch',
        event = 'VeryLazy',
    },
    {
        'tpope/vim-repeat',
        extra_contexts = {"vscode", "firenvim", "lite_mode"}
    },
    {
        'tpope/vim-abolish',
        keys = {"cr"},
        cmd = {"Abolish", "Subvert", "S"},
        extra_context = {'lite_mode'}
    },
    {
        'tpope/vim-sleuth',
        event = { "BufReadPost", "BufNewFile", "BufFilePost"},
        extra_context = {'lite_mode'}
    },
    {
        'tpope/vim-rsi',
        event = {"CmdlineEnter", "InsertEnter"},
        extra_contexts = {"vscode", "firenvim", "lite_mode"}
    },
    {
        'tpope/vim-unimpaired',
        event = "VeryLazy",
        extra_contexts = {"firenvim", "lite_mode", "vscode"}
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
        },
        extra_contexts = {"lite_mode"},
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
