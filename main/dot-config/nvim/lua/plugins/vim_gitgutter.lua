return {
    'airblade/vim-gitgutter',
    init = function()
        vim.g.gitgutter_map_keys = 0
    end,
    config = function()
        vim.keymap.set("o", "ih", "<Plug>GitGutterTextObjectInnerPending", { remap = true })
        vim.keymap.set("o", "ah", "<Plug>GitGutterTextObjectOuterPending", { remap = true })
        vim.keymap.set("x", "ih", "<Plug>GitGutterTextObjectInnerVisual", { remap = true })
        vim.keymap.set("x", "ah", "<Plug>GitGutterTextObjectOuterVisual", { remap = true })
    end,
}
