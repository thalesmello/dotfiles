return {
    'tpope/vim-dispatch',
    cmd = { "Dispatch", "Make", "Focus", "Start", "Spawn", "Copen" },
    keys = {
        { "m<cr>", mode = "n" },
        { "m<space>", mode = "n" },
        { "m!", mode = "n" },
        { "m?", mode = "n" },
        { "`<cr>", mode = "n" },
        { "`<space>", mode = "n" },
        { "`!", mode = "n" },
        { "`?", mode = "n" },
        { "'<cr>", mode = "n" },
        { "'<space>", mode = "n" },
        { "'!", mode = "n" },
        { "'?", mode = "n" },
    },
    init = function()
        vim.g.dispatch_no_tmux_make = 1

        vim.g.dispatch_compilers = {
            python3= 'python',
        }
    end,
}
