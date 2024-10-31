return {
    'AndrewRadev/undoquit.vim',
    keys = {"<leader>T"},
    cmd = {"Undoquit"},
    init = function()
        vim.g.undoquit_mapping = '<leader>T'
    end,
}
