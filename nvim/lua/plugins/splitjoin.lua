return {

    {
        'AndrewRadev/splitjoin.vim',
        init = function()
            vim.g.splitjoin_python_brackets_on_separate_lines = 1
            vim.g.splitjoin_split_mapping = ''; vim.g.splitjoin_join_mapping = ''
        end,
        keys = {
            {
                "gS",
                function () vim.cmd.SplitjoinSplit() end,
                mode = "n"
            },
            {
                "gJ",
                function () vim.cmd.SplitjoinJoin() end,
                mode = "n",
            },
        },
        extra_contexts = {"vscode", "firenvim"},
        lazy = false
    },
    {
        'echasnovski/mini.splitjoin',
        version = '*',
        keys = {"<leader>gS", "<leader>gJ"},
        opts = {
            mappings = {
              toggle = '',
              split = '<leader>gS',
              join = '<leader>gJ',
            },
        },
        extra_contexts = {"vscode", "firenvim"},
    },

    {
        'Wansmer/treesj',
        enabled = false,
        dependencies = {
            'nvim-treesitter/nvim-treesitter',
            'AndrewRadev/splitjoin.vim',
        },
        opts = {
            -- Use default keymaps
            -- (<space>m - toggle, <space>j - join, <space>s - split)
            use_default_keymaps = false,

            -- Node with syntax error will not be formatted
            check_syntax_error = true,

            -- If line after join will be longer than max value,
            -- node will not be formatted
            max_join_length = 1200,

            -- hold|start|end:
            -- hold - cursor follows the node/place on which it was called
            -- start - cursor jumps to the first symbol of the node being formatted
            -- end - cursor jumps to the last symbol of the node being formatted
            cursor_behavior = 'hold',

            -- Notify about possible problems or not
            notify = true,

            -- Use `dot` for repeat action
            dot_repeat = true,
        },
        keys = {
            {"gS",
                function ()
                    if require('treesj.langs')['presets'][vim.bo.filetype] then
                        vim.cmd.TSJSplit()
                    else
                        vim.cmd.SplitjoinSplit()
                    end
                end,
                mode = "n"},
            {
                "gJ",
                function ()
                    if require('treesj.langs')['presets'][vim.bo.filetype] then
                        vim.cmd.TSJJoin()
                    else
                        vim.cmd.SplitjoinJoin()
                    end
                end,
                mode = "n",
            },
        },
        cmd = {"TSJSplit", "TSJJoin"},
        lazy = true,
        extra_contexts = {"vscode", "firenvim"}
    },
}

