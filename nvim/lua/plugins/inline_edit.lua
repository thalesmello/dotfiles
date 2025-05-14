return {
    'AndrewRadev/inline_edit.vim',
    keys = {
        {'<leader>ie',  'vii:InlineEdit<space><up>', remap = true, mode = "n"},
        -- We navigate up to fetch the last used InlineEdit used command
        {'<leader>ie', ':InlineEdit<space><up>', remap = true, mode = "x"}
    },
    config = function ()
        -- require('conditional_load').exec_when({ vscode = true }, function ()
        --     vim.g.inline_edit_proxy_type = "vscode"
        -- end)
    end,
    cmd = "InlineEdit",
    extra_contexts = {"firenvim"}
}
