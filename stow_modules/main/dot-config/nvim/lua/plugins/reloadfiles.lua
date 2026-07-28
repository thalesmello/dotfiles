return {
    {
        dir = vim.fn.stdpath("config") .. "/local_plugins/reloadfiles/",
        dev = true,
        config = function()
            require('reloadfiles').setup()
        end,
        extra_contexts = {"ssh"}
    },
}
