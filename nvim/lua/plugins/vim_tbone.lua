return {
    'tpope/vim-tbone',
    config = function() require('config/tbone') end,
    cond = vim.env.TMUX,
}
