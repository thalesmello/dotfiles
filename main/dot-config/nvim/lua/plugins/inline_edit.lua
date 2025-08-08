return {
    'thalesmello/inline_edit.vim',
    branch = 'vscode',
    keys = {
        {'<leader>ie',  'vii:InlineEdit<space><up>', remap = true, mode = "n"},
        -- We navigate up to fetch the last used InlineEdit used command
        {'<leader>ie', ':InlineEdit<space><up>', remap = true, mode = "x"}
    },
    config = function ()
        vim.g.inline_edit_autowrite = 1
    end,
    cmd = "InlineEdit",
    extra_contexts = {"firenvim", "vscode"}
}
