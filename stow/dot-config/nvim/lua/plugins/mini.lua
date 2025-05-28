local vim_utils = require('vim_utils')
local ftmini = require('ftmini')

return {
    { 'echasnovski/mini.comment', version = false, opts = {} },
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
                search_method = "cover",
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

                vim.keymap.set({"o"}, "g[", "<Plug>(mini-ai-goto-left)", { remap = true })

                vim.keymap.set({"o"}, "g]", "<Plug>(mini-ai-goto-right)", { remap = true })

                -- local function arroundinner(mode)
                --     local ok, char = pcall(vim.fn.getcharstr)
                --     if not ok or char == '\27' then return nil end
                --
                --     local command
                --     if mode == "i" then
                --         command = "<Plug>(mini-ai-inner)"
                --     else
                --         command = "<Plug>(mini-ai-around)"
                --     end
                --
                --     local repeatMove = ts_repeat_move.make_repeatable_move(
                --         function ()
                --             vim_utils.feedkeys(command .. char)
                --         end
                --     )
                --
                --     repeatMove({forward = true})
                -- end

                -- vim.keymap.set({ "x" }, "a", function () arroundinner("a") end, {remap=true})
                -- vim.keymap.set({ "x" }, "i", function () arroundinner("i") end, {remap=true})
                -- vim.keymap.set({ "o" }, "a", "<Plug>(mini-ai-around)", {remap=true})
                -- vim.keymap.set({ "o" }, "i", "<Plug>(mini-ai-inner)", {remap=true})

            end

            local function set_buffer_config(filetype)
                local config = ftmini.ftmini_config(filetype)
                vim.b.miniai_config = { custom_textobjects = config.custom_textobjects or {} }
            end

            local group = vim.api.nvim_create_augroup("MiniAiFiletypeGroup", { clear = true })
            vim.api.nvim_create_autocmd({ 'FileType' }, {
                group = group,
                pattern = "*",
                callback = function(opts) set_buffer_config(opts.match) end,
            })

            vim.api.nvim_create_autocmd({ 'User' }, {
                group = group,
                pattern = "TreesitterEmbeddedFileType",
                callback = function(opts) set_buffer_config(opts.data.filetype) end,
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
                search_method = 'cover',
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

            local function set_buffer_config(filetype)
                local config = ftmini.ftmini_config(filetype)
                vim.b.minisurround_config = { custom_surroundings = config.custom_surroundings or {} }
            end

            local group = vim.api.nvim_create_augroup("MiniSurroundGroup", { clear = true })
            vim.api.nvim_create_autocmd({ 'FileType' }, {
                group = group,

                pattern = "*",
                callback = function(opts)
                    set_buffer_config(opts.match)
                end,
            })

            vim.api.nvim_create_autocmd({ 'User' }, {
                group = group,
                pattern = "TreesitterEmbeddedFileType",
                callback = function(opts)
                    set_buffer_config(opts.data.filetype)
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
