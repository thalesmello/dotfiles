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
                local function repeatable_goto_ai(direction)
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
                    repeatable_goto_ai("left")
                end)

                vim.keymap.set({ "n", "x" }, "g]", function ()
                    repeatable_goto_ai("right")
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
        end,
    },
    {
        "thalesmello/mini.surround",
        version = false,
        extra_contexts = {"vscode", "firenvim"},
        config = function ()
            local surround = require('mini.surround')
            local get_input = surround.user_input
            surround.setup({
                custom_surroundings = {
                    ['?'] = {
                        input = function()
                            local surroundings = get_input('Left Surround ||| Right Surround')

                            local left, right = unpack(vim.split(surroundings, "|||"))

                            if left == nil or left == '' then return end
                            if right == nil or right == '' then return end

                            return { vim.pesc(left) .. '().-()' .. vim.pesc(right) }
                        end,
                        output = function()
                            local surroundings = get_input('Left Surround ||| Right Surround')

                            local left, right = unpack(vim.split(surroundings, "|||"))

                            if left == nil then return end
                            if right == nil then return end
                            return { left = left, right = right }
                        end,
                    },
                },
                mappings = {
                    -- add = 'ys',
                    -- delete = 'ds',
                    -- yank = '<leader>sy',
                    -- paste = '<leader>sp',
                    -- find = '<leader>sf',
                    -- find_left = '<leader>sF',
                    -- highlight = '<leader>sh',
                    -- replace = 'cs',
                    -- update_n_lines = '<leader>sn',
                    --
                    -- -- Add this only if you don't want to use extended mappings
                    -- suffix_last = 'l',
                    -- suffix_next = 'n',
                    add = '<leader>sa',
                    delete = '<leader>sd',
                    yank = '<leader>sy',
                    paste = '<leader>sp',
                    find = '<leader>sf',
                    find_left = '<leader>sF',
                    highlight = '<leader>sh',
                    replace = '<leader>sr',
                    update_n_lines = '<leader>sn',

                    -- Add this only if you don't want to use extended mappings
                    suffix_last = 'l',
                    suffix_next = 'n',
                },
                search_method = 'cover_or_next',
                respect_selection_type = true,
                n_lines = 1000,
            })

            -- Remap adding surrounding to Visual mode selection
            -- vim.keymap.del('x', 'ys')
            -- vim.keymap.set('x', 'S', [[:<C-u>lua MiniSurround.add('visual')<CR>]], { silent = true })

            -- Make special mapping for "add surrounding for line"
            -- vim.keymap.set('n', 'yss', 'ys_', { remap = true })

            -- vim.keymap.set('i', '<c-s>', function ()
            --     vim.api.nvim_create_autocmd({ 'InsertEnter' }, {
            --         pattern = '*',
            --         once = true,
            --         callback = function()
            --             local col = vim.fn.col('.')
            --             -- For some reason, at cursor column there's a "<c2>" caracter
            --             -- And therefore to select the character in from of the cursor I have
            --             -- To use col + 1, even though end indices are inclusive in lua
            --             -- I couldn't find any documentation, but I think <c2> is an internal representation
            --             -- for the cursor output from getline('.')
            --             local char_under_cursor = vim.fn.getline('.'):sub(1):sub(col, col+1)
            --             if char_under_cursor == '§' then
            --                 vim_utils.feedkeys("<c-o>x")
            --             end
            --         end,
            --     })
            --     vim_utils.feedkeys('§<left><c-o>v:<c-u>lua require("mini.surround").add("visual")<cr>', 'n')
            -- end, {silent=true})

            local filetype_map = {
                python = {"sqljinja", "python"},
                jinja = {"sqlfile", "jinja"},
                sql = {"sqlfile", "sql"},
            }

            vim.api.nvim_create_autocmd({ 'FileType' }, {
                group = vim.api.nvim_create_augroup("MiniSurroundGroup", { clear = true }),
                pattern = "*",
                callback = function(opts)
                    local filetype = opts.match
                    local iter_filetypes = filetype_map[filetype] or {filetype}

                    for _, ft in ipairs(iter_filetypes) do
                        local ok, ftconfig = pcall(require, "ftmini." .. ft)
                        if ok then
                            vim.b.minisurround_config = vim.tbl_deep_extend("force", vim.b.minisurround_config or {}, ftconfig)
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
