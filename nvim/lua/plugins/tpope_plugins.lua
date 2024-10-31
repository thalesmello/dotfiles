return {
    { 'tpope/vim-eunuch', event = 'VeryLazy'},
    { 'tpope/vim-repeat' },
    { 'tpope/vim-abolish', keys = {"cr"}, cmd = {"Abolish", "Subvert"}},
    {
        'tpope/vim-sleuth',
        event = { "BufReadPost", "BufNewFile", "BufFilePost" },
    },
    { 'tpope/vim-rsi', event = {"CmdlineEnter", "InsertEnter"} },
    { 'tpope/vim-unimpaired', event = "VeryLazy" },
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
}
