local vim_utils = require('vim_utils')

return {
    {
        'echasnovski/mini.ai',
        version = false,
        extra_contexts = {"vscode", "firenvim"},
        config = function()
            local spec_pair = require('mini.ai').gen_spec.pair
            local spec_treesitter = require('mini.ai').gen_spec.treesitter

            require('mini.ai').setup({

                mappings = {
                    around = 'a',
                    inside = 'i',

                    -- Next/last textobjects
                    around_next = 'an',
                    inside_next = 'in',
                    around_last = 'al',
                    inside_last = 'il',
                    goto_left = '<Plug>(mini-ai-goto-left)',
                    goto_right = '<Plug>(mini-ai-goto-right)',
                },
                custom_textobjects = {
                    ["f"] = { '%f[%w_%.][%w_%.]+%b()', '^.-%(().*()%)$' },
                    ["F"] = spec_treesitter({ a = "@function.outer", i = "@function.inner" }),
                    -- [";"] = spec_treesitter({ a = "@pair.value", i = "" }),
                    -- [":"] = spec_treesitter({ a = "@pair.key", i = "" }),
                    -- [":"] = spec_treesitter({ a = "@pair.key", i = "" }),
                    ["C"] = spec_treesitter({ i = "@class.inner", a = "@class.outer" }),
                    ["P"] = function()
                        local _, sline, scol, _ = unpack(vim.fn.getpos("'["))
                        local _, eline, ecol, _ = unpack(vim.fn.getpos("']"))
                        local mode = vim.fn.visualmode()

                        return {
                            from = { line = sline, col = scol },
                            to = { line = eline, col = ecol },
                            vis_mode = mode,
                        }
                    end,
                    ['.'] = { { "[^a-zA-Z0-9_%.]%s*[%a_][a-zA-Z0-9_%.]*,?", "^%s*()[%a_][a-zA-Z0-9_%.]*,?" }, "^[^a-zA-Z0-9_%.]?()%s*()[%a_][a-zA-Z0-9_%.]*(),?()$" },
                },
                search_method = "cover_or_next",
                n_lines = 1000,
            })


            vim.keymap.set({ "o" }, "gp", "aP", {remap = true})
            vim.keymap.set({ "n" }, "gp", "vaP", {remap = true})
            vim.keymap.set({ "v" }, "gp", "avP", {remap = true})

            local repeatable_ok, ts_repeat_move = pcall(require, "nvim-treesitter.textobjects.repeatable_move")

            if repeatable_ok then
                local function goto(direction)
                    local ok, char = pcall(vim.fn.getcharstr)
                    if not ok or char == '\27' then return nil end
                    local moveLeft, moveRight = ts_repeat_move.make_repeatable_move_pair(
                        function ()
                            vim_utils.feedkeys("<Plug>(mini-ai-goto-left)" .. char)
                        end,
                        function ()
                            vim_utils.feedkeys("<Plug>(mini-ai-goto-right)" .. char)
                        end
                    )

                    if direction == "left" then
                        moveLeft()
                    else
                        moveRight()
                    end
                end

                vim.keymap.set({ "n", "x" }, "g[", function ()
                    goto("left")
                end)
                vim.keymap.set({ "n", "x" }, "g]", function ()
                    goto("right")
                end)

                -- local function arroundinner()
                --     local ok, char = pcall(vim.fn.getcharstr)
                --     if not ok or char == '\27' then return nil end
                --
                --     if vim.list_contains({"n", "l"}, char) then
                --         local newchar
                --         ok, newchar = pcall(vim.fn.getcharstr)
                --         if not ok or newchar == '\27' then return nil end
                --         char = char .. newchar
                --     end
                --
                --
                --     local repeatMove = ts_repeat_move.make_repeatable_move(
                --         function ()
                --             vim_utils.feedkeys("A" .. char)
                --         end
                --     )
                --
                --     repeatMove()
                -- end
                --
                -- vim.keymap.set({ "x", "o" }, "a", arroundinner)
            end

            local filetype_map = {
                python = {"sqljinja", "python"},
                jinja = {"sqlfile", "jinja"},
                sql = {"sqlfile", "sql"},
            }

            vim.api.nvim_create_autocmd({ 'FileType' }, {
                group = vim.api.nvim_create_augroup("MiniAiFiletypeGroup", { clear = true }),
                pattern = "*",
                callback = function(opts)
                    local filetype = opts.match
                    local iter_filetypes = filetype_map[filetype] or {filetype}

                    for _, ft in ipairs(iter_filetypes) do
                        local ok, ftconfig = pcall(require, "ftmini." .. ft)
                        if ok then
                            vim.b.miniai_config = vim.tbl_deep_extend("force", vim.b.miniai_config or {}, ftconfig)
                        end
                    end
                end,
            })
        end
    },
    {
        'echasnovski/mini.operators',
        version = false,
        opts = {
            -- Evaluate text and replace with output
            evaluate = {
                prefix = 'g=',

                -- Function which does the evaluation
                func = nil,
            },

            -- Exchange text regions
            exchange = {
                prefix = 'gx',

                -- Whether to reindent new text to match previous indent
                reindent_linewise = true,
            },

            -- Multiply (duplicate) text
            multiply = {
                prefix = 'gm',

                -- Function which can modify text before multiplying
                func = nil,
            },

            -- Replace text with register
            replace = {
                prefix = 'gr',

                -- Whether to reindent new text to match previous indent
                reindent_linewise = true,
            },

            -- Sort text
            sort = {
                prefix = 'go',

                -- Function which does the sort
                func = nil,
            }
        },
        config = function (_, opts)
            require("mini.operators").setup(opts)

            vim.keymap.set("n", "<leader>gr", '"+gr', { remap = true })
        end,
        extra_contexts = {"vscode", "firenvim"},
    }
}
