return {
    {
        'thalesmello/vim-islime2',
        config = function()
            vim.g.islime2_29_mode = 1
        end,
        event = "VeryLazy",
    },
    {
        dir = vim.fn.stdpath("config") .. "/local_plugins/neoterminal/",
        dev = true,
        config = function ()
            require('neovimterminal')
            require('smart_send_text')
        end,
        dependencies = {
            "thalesmello/vim-projectionist"
        }
    },
}
