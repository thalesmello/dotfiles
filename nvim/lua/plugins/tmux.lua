return {
    {
        'tmux-plugins/vim-tmux-focus-events',
        tag = 'v1.0.0',
        event = "TermOpen",
    },
    { 'tmux-plugins/vim-tmux', ft = "tmux" },
    {
        'sainnhe/tmuxline.vim',
        config = function() require('config/tmuxline') end,
        cmd = {
            "Tmuxline",
            "TmuxlineSnapshot",
        }
    },
    -- { 'wellle/tmux-complete.vim' },
    cond = not vim.env.TMUX
}
