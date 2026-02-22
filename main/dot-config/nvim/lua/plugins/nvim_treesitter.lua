local vim_utils = require("vim_utils")

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
            'kana/vim-textobj-user',
        },
        opts = function(_, opts)
            return vim.tbl_deep_extend('force', opts or {}, {
                ensure_installed = { "lua", "vim", "python", "ruby", "query",
                    "sql", "regex", "markdown", "markdown_inline", "html",
                    "latex", "typst", "yaml", "fish" },

                modules = {},
                sync_install = false,
                ignore_install = {},

                highlight = {
                    enable = true,
                    additional_vim_regex_highlighting = false,
                },

                auto_install = true,

                incremental_selection = {
                    enable = true,
                    keymaps = {
                        init_selection = "ghh", -- set to `false` to disable one of the mappings
                        node_incremental = "gh]",
                        scope_incremental = "gh}",
                        node_decremental = "gh[",
                    },
                },

                indent = {
                    enable = true
                },

                textobjects = {
                    select = {
                        enable = true,

                        -- Automatically jump forward to textobj, similar to targets.vim
                        lookahead = true,

                        keymaps = {
                            -- You can use the capture groups defined in textobjects.scm
                            -- ["af"] = "@function.outer",
                            -- ["if"] = "@function.inner",
                            -- ["i,"] = "@parameter.inner",
                            -- ["a,"] = "@parameter.outer",
                            -- ["a;"] = "@pair.value",
                            -- ["a:"] = "@pair.key",
                            -- ["aq"] = "@multiline_string.outer",
                            -- ["iq"] = "@multiline_string.inner",
                            -- You can optionally set descriptions to the mappings (used in the desc parameter of
                            -- nvim_buf_set_keymap) which plugins like which-key display
                            -- ["iC"] = { query = "@class.inner", desc = "Select inner part of a class region" },
                            -- ["aC"] = { query = "@class.outer", desc = "Select outer part of a class region" },
                            -- You can also use captures from other query groups like `locals.scm`
                            -- ["as"] = { query = "@scope", query_group = "locals", desc = "Select language scope" },
                        },

                        selection_modes = {
                            -- ['@parameter.outer'] = 'v', -- charwise
                            -- ['@function.outer'] = 'v', -- linewise
                            -- ['@class.outer'] = '<c-v>', -- blockwise
                        },

                    },

                    move = {
                        enable = true,
                        set_jumps = true, -- whether to set jumps in the jumplist
                        goto_next_start = {
                            -- ["],"] = "@parameter.outer",
                            ["]m"] = "@function.outer",
                            ["]]"] = { query = "@class.outer", desc = "Next class start" },
                            --
                            -- You can use regex matching (i.e. lua pattern) and/or pass a list in a "query" key to group multiple queires.
                            ["]o"] = "@loop.*",
                            -- ["]o"] = { query = { "@loop.inner", "@loop.outer" } }
                            --
                            -- You can pass a query group to use query from `queries/<lang>/<query_group>.scm file in your runtime path.
                            -- Below example nvim-treesitter's `locals.scm` and `folds.scm`. They also provide highlights.scm and indent.scm.
                            ["]s"] = { query = "@scope", query_group = "locals", desc = "Next scope" },
                            ["]z"] = { query = "@fold", query_group = "folds", desc = "Next fold" },
                        },
                        goto_next_end = {
                            ["]M"] = "@function.outer",
                            ["]["] = "@class.outer",
                        },
                        goto_previous_start = {
                            -- ["[,"] = "@parameter.outer",
                            ["[m"] = "@function.outer",
                            ["[["] = "@class.outer",
                            ["[z"] = { query = "@fold", query_group = "folds", desc = "Prev fold" },
                        },
                        goto_previous_end = {
                            ["[M"] = "@function.outer",
                            ["[]"] = "@class.outer",
                        },
                        -- Below will go to either the start or the end, whichever is closer.
                        -- Use if you want more granular movements
                        -- Make it even more gradual by adding multiple queries and regex.
                        goto_next = {
                            ["]i"] = "@conditional.outer",
                        },
                        goto_previous = {
                            ["[i"] = "@conditional.outer",
                        }
                    },

                    swap = {
                        enable = true,
                        swap_next = {
                            -- [">,"] = "@parameter.inner",
                        },
                        swap_previous = {
                            -- ["<,"] = "@parameter.inner",
                        },
                    },


                    lsp_interop = {
                        enable = true,
                        border = 'none',
                        floating_preview_opts = {},
                        peek_definition_code = {
                            ["<leader>df"] = "@function.outer",
                            ["<leader>dF"] = "@class.outer",
                        },
                    },
                },


                query_linter = {
                    enable = true,
                    use_virtual_text = true,
                    lint_events = {"BufWrite", "CursorHold"},
                },
            })
        end,
        config = function (_, opts)
            require('nvim-treesitter.configs').setup(opts)

            local group = vim.api.nvim_create_augroup("TreesitterAutogroup", {
                clear = true
            })

            for _, lang in ipairs({"python"}) do
                vim.api.nvim_create_autocmd({ 'FileType' }, {
                    group = group,
                    pattern = lang,
                    callback = function()
                        vim.opt_local.foldmethod = "expr"
                        vim.opt_local.foldexpr = "nvim_treesitter#foldexpr()"
                    end,
                })
            end

            local ts_repeat_move = require("nvim-treesitter.textobjects.repeatable_move")

            vim.keymap.set({ "n", "x" }, ";", ts_repeat_move.repeat_last_move)
            vim.keymap.set({ "n", "x" }, ",", ts_repeat_move.repeat_last_move_opposite)
            vim.keymap.set({ "n", "x" }, "f", ts_repeat_move.builtin_f_expr, { expr = true })
            vim.keymap.set({ "n", "x" }, "F", ts_repeat_move.builtin_F_expr, { expr = true })
            vim.keymap.set({ "n", "x" }, "t", ts_repeat_move.builtin_t_expr, { expr = true })
            vim.keymap.set({ "n", "x" }, "T", ts_repeat_move.builtin_T_expr, { expr = true })
            vim.keymap.set({ "n" }, "<leader>eto", function()
                local config = vim.fn.stdpath("config")

                local filetype = vim.o.filetype

                if filetype == '' then
                    return
                end

                vim.cmd.edit(config .. "/after/queries/" .. filetype .. '/textobjects.scm')
            end)


            vim.keymap.set({ "n" }, "<leader>eti", function()
                local config = vim.fn.stdpath("config")

                local filetype = vim.o.filetype

                if filetype == '' then
                    return
                end

                vim.cmd.edit(config .. "/after/queries/" .. filetype .. '/injections.scm')
            end)

            vim.api.nvim_create_autocmd({ 'CursorHold' }, {
                group = group,
                pattern = "*",
                callback = function()
                    local prev_filetype = vim.b.treesitter_prev_filetype

                    local line = vim.fn.line('.')

                    local ok, parser = pcall(vim.treesitter.get_parser)

                    if not ok then
                        return
                    end

                    if not vim.b.treesitter_full_buffer_parse then
                        parser:parse(true)
                        vim.b.treesitter_full_buffer_parse = true
                    end

                    local filetype = parser:language_for_range({line, 0, line, 0}):lang()

                    if filetype ~= prev_filetype then
                        vim.b.treesitter_prev_filetype = filetype
                        vim.api.nvim_exec_autocmds("User", {
                            pattern = "TreesitterEmbeddedFileType",
                            data = {
                                filetype = filetype
                            }
                        })
                    end
                end,
            })
        end,
        extra_contexts = {"vscode", "firenvim", "ssh"},
        lazy = false,
    },
    {

        "cshuaimin/ssr.nvim",
        main = "ssr",
        -- Calling setup is optional.
        keys = {
            {
                "<leader>ssr",
                function() require("ssr").open() end,
                { desc = "[S]tructural Replace [T]reesitter" },
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

    vim_utils.injector_module({
        'RRethy/nvim-treesitter-textsubjects',
        opts = {
            prev_selection = '<bs>',
            keymaps = {
                ['<cr>'] = 'textsubjects-smart',
                ['a<cr>'] = 'textsubjects-container-outer',
                ['i<cr>'] = 'textsubjects-container-inner' ,
            },
        },
        config = function (_, opts) require('nvim-treesitter-textsubjects').configure(opts) end,
        dependencies = {"nvim-treesitter/nvim-treesitter"},
        extra_contexts = {"vscode", "firenvim"}
    })
}
