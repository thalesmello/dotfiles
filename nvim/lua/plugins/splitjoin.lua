return {
    {
        'AndrewRadev/splitjoin.vim',
        init = function()
            vim.g.splitjoin_python_brackets_on_separate_lines = 1
            vim.g.splitjoin_split_mapping = ''
            vim.g.splitjoin_join_mapping = ''

            vim.keymap.set('n', '<leader>gS', '<Cmd>SplitjoinSplit<CR>', { silent = true, desc = "Split structure" })
            vim.keymap.set('n', '<leader>gJ', '<Cmd>SplitjoinJoin<CR>', { silent = true, desc = "Join structure" })
        end,
        extra_contexts = {"vscode", "firenvim"}
    },
    {
        'Wansmer/treesj',
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
        lazy = false,
        extra_contexts = {"vscode", "firenvim"}
    },
}
