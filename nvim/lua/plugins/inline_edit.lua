return {
    'AndrewRadev/inline_edit.vim',
    keys = {
        {'<leader>ie',  '<cmd>InlineEdit<cr>',  silent = true},
        -- We navigate up to fetch the last used InlineEdit used command
        {'<leader>ie', ':InlineEdit<space><up>', remap = true, mode = "x"}
    },
    config = function ()
        vim.g.inline_edit_proxy_type = "tempfile"
    end,
    cmd = "InlineEdit",
    firenvim = true,
    vscode = true,
}
