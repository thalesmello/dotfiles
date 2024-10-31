return {
    'AndrewRadev/inline_edit.vim',
    keys = {
        {'<leader>ie',  '<cmd>InlineEdit<cr>',  silent = true},
        {'<leader>ie', ':InlineEdit<space>""<left>', remap = true, mode = "x"}
    },
    cmd = "InlineEdit",
}
