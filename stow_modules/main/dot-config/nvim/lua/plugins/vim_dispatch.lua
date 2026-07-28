return {
    'tpope/vim-dispatch',
    init = function()
        vim.g.dispatch_no_tmux_make = 1

        vim.g.dispatch_compilers = {
            python3= 'python',
        }
    end,
}
