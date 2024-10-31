return {
    'simeji/winresizer',
    keys = {
        {"<leader>H", '<leader>wrH', remap = true},
        {"<leader>J", '<leader>wrJ', remap = true},
        {"<leader>K", '<leader>wrK', remap = true},
        {"<leader>L", '<leader>wrL', remap = true},
    },
    init = function()
        vim.g.winresizer_start_key = '<leader>wr'
        vim.g.winresizer_keycode_left = 72
        vim.g.winresizer_keycode_right = 76
        vim.g.winresizer_keycode_down = 74
        vim.g.winresizer_keycode_up = 75
    end
}
