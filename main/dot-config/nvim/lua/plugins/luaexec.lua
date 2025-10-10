return {
    {
        dir = vim.fn.stdpath("config") .. "/local_plugins/luaexec/",
        dev = true,
        config = function ()
            require('luaexec').setup()

            vim.keymap.set({'n', 'x'}, '<leader>x', '<Plug>LuaExecOperator', {remap = true, silent = true})
            vim.keymap.set({'n'}, '<leader>xx', '<Plug>LuaExecOperator_', {remap = true, silent = true})
        end,
        extra_contexts = {"firenvim", "lite_mode"}
    },
}
