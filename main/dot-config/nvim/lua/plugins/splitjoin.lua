local conditional_load = require('conditional_load')
local should_load = conditional_load.should_load
return {

    {
        'AndrewRadev/splitjoin.vim',
        init = function()
            vim.g.splitjoin_python_brackets_on_separate_lines = 1
            vim.g.splitjoin_split_mapping = ''
            vim.g.splitjoin_join_mapping = ''
        end,
        -- keys = {
        --     {
        --         "gS",
        --         function ()
        --             local didSplit vim.fn["sj#Split"]()
        --
        --             if didSplit == 0 then
        --                 require('mini.splitjoin').split()
        --             end
        --         end,
        --         mode = "n"
        --     },
        --     {
        --         "gJ",
        --         function ()
        --             local didJoin vim.fn["sj#Join"]()
        --
        --             if didJoin == 0 then
        --                 require('mini.splitjoin').split()
        --             end
        --         end,
        --         mode = "n",
        --     },
        -- },
        extra_contexts = {"vscode", "firenvim"},
        lazy = false
    },
    {
        'echasnovski/mini.splitjoin',
        version = '*',
        opts = {
            mappings = {
                toggle = '',
                split = should_load('lite_mode') and 'gS' or '<leader>gS',
                join = should_load('lite_mode') and 'gJ' or '<leader>gJ',
            },
        },
        extra_contexts = {"vscode", "firenvim", "lite_mode"},
    },

    {
        'Wansmer/treesj',
        enabled = true,
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
                    local treesjBefore = vim.api.nvim_buf_line_count(0)

                    require('treesj').split()

                    local treesjAfter = vim.api.nvim_buf_line_count(0)

                    if treesjAfter ~= treesjBefore then return end

                    local didSplitJoin = vim.fn["sj#Split"]()

                    if didSplitJoin ~= 0 then return end

                    require('mini.splitjoin').split()
                end,
                mode = "n"},
            {
                "gJ",
                function ()
                    local treesjBefore = vim.api.nvim_buf_line_count(0)

                    require('treesj').join()

                    local treesjAfter = vim.api.nvim_buf_line_count(0)

                    if treesjAfter ~= treesjBefore then return end

                    local didSplitJoin = vim.fn["sj#Join"]()

                    if didSplitJoin ~= 0 then return end

                    require('mini.splitjoin').join()
                end,
                mode = "n",
            },
        },
        cmd = {"TSJSplit", "TSJJoin"},
        lazy = true,
        extra_contexts = {"vscode", "firenvim"}
    },
}

