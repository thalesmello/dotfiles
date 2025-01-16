return {
   {
        dir = vim.fn.stdpath("config") .. "/local_plugins/fish-bang/",
        dev = true,
        config = function ()
            require('fish_bang').setup()
        end
    }
}
