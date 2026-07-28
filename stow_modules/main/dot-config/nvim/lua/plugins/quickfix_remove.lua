return {
    {
        dir = vim.fn.stdpath("config") .. "/local_plugins/quickfix_remove/",
        dev = true,
        config = function ()
            require('quickfix_remove')
        end,
        cmd = 'RemoveQFItem'
    },
}
