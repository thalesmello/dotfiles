return {
    {
        'nvim-treesitter/nvim-treesitter',
        event = { "BufReadPost", "BufNewFile", "BufFilePost" },
        build = function ()
            vim.cmd('TSUpdate')
        end,
        dependencies = {
            'nvim-treesitter/nvim-treesitter-textobjects',
            'nvim-treesitter/nvim-treesitter-context',
            'nvim-treesitter/playground',
            'andymass/vim-matchup',
            'kana/vim-textobj-user',
        },
        config = function ()
            require('config/treesitter')
        end,
        vscode = true,
    },
    {

        "cshuaimin/ssr.nvim",
        main = "ssr",
        -- Calling setup is optional.
        keys = {
            {
                "<leader>sr",
                function() require("ssr").open() end,
                { desc = "[S]tructural [R]eplace" },
            }
        },
        opts = {
            border = "rounded",
            min_width = 50,
            min_height = 5,
            max_width = 120,
            max_height = 25,
            adjust_window = true,
            keymaps = {
                close = "q",
                next_match = "n",
                prev_match = "N",
                replace_confirm = "<cr>",
                replace_all = "<leader><cr>",
            },
        }
    },
}
