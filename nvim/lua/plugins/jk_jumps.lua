return {
    {
        dir = vim.fn.stdpath("config") .. "/local_plugins/jk_jumps/",
        dev = true,
        config = function ()
            require('jk_jumps')
        end
    },
}
