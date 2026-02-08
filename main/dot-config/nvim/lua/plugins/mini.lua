local vim_utils = require('vim_utils')
local ftmini = require('ftmini')

return {
    {
        'echasnovski/mini.comment',
        version = false,
        opts = {},
        extra_contexts = {"lite_mode", "ssh"},
    },
    {
        "echasnovski/mini.diff",
        config = function()
            local diff = require("mini.diff")
            diff.setup({
                source = diff.gen_source.none(),
            })
        end,
    },
    {
        'echasnovski/mini.ai',
        version = '*',
        dependencies = {'nvim-treesitter/nvim-treesitter'},
        extra_contexts = {"vscode", "firenvim", "lite_mode", "ssh"},
        config = function()
            local mini_ai = require('mini.ai')

            mini_ai.setup({

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
                },
                search_method = "cover",
                n_lines = 1000,
            })


            vim.keymap.set({ "o" }, "gp", "aP", {remap = true})
            vim.keymap.set({ "n" }, "gp", "vaP", {remap = true})
            vim.keymap.set({ "v" }, "gp", "avP", {remap = true})

            local repeatable_ok, ts_repeat_move = pcall(require, "nvim-treesitter.textobjects.repeatable_move")

            if repeatable_ok then
                local function repeatable_goto_ai(opts)
                    local ai = opts.ai or 'a'
                    local direction = opts.direction
                    local left_sm, right_sm = unpack(opts.search_method_pair or {"cover_or_prev", "cover_or_next"})
                    local ok, char = pcall(vim.fn.getcharstr)
                    if not ok or char == '\27' then return nil end
                    local moveLeft, moveRight = ts_repeat_move.make_repeatable_move_pair(
                        function ()
                            local pos = vim.fn.getpos('.')
                            vim.cmd("silent! lua MiniAi.move_cursor('left', ".. vim.fn.shellescape(ai) ..", " .. vim.fn.shellescape(char) .. ")")

                            if vim.deep_equal(vim.fn.getpos('.'), pos) then
                                if vim.fn.mode() == "n" then
                                    vim.cmd.normal(vim_utils.keycodes('v' .. ai .. char .. "<esc>`<"))
                                else
                                    vim.cmd.normal(vim_utils.keycodes('<esc>'))
                                    local visend = vim.fn.getpos("'>")
                                    vim.cmd.normal(vim_utils.keycodes('v' .. ai .. char .. "<esc>"))
                                    vim.fn.setpos("'>", {0, visend[2], visend[3], 0})
                                    vim.cmd.normal({ args = {vim_utils.keycodes([[gv]])}, bang = true })
                                end

                            end
                        end,
                        function ()
                            local pos = vim.fn.getpos('.')
                            vim.cmd("silent! lua MiniAi.move_cursor('right', ".. vim.fn.shellescape(ai) ..", " .. vim.fn.shellescape(char) .. ", {search_method=left_sm})")

                            if vim.deep_equal(vim.fn.getpos('.'), pos) then
                                if vim.fn.mode() == "n" then
                                    vim.cmd.normal(vim_utils.keycodes('v' .. ai .. char .. "<esc>`>"))
                                else
                                    vim.cmd.normal(vim_utils.keycodes('<esc>'))
                                    local visend = vim.fn.getpos("'<")
                                    vim.cmd.normal(vim_utils.keycodes('v' .. ai .. char .. "<esc>"))
                                    vim.fn.setpos("'<", {0, visend[2], visend[3], 0})
                                    vim.cmd.normal({ args = {vim_utils.keycodes([[gv]])}, bang = true })
                                end
                            end
                        end
                    )

                    if direction == "left" then
                        moveLeft()
                    else
                        moveRight()
                    end
                end

                vim.keymap.set({ "n", "x" }, "g[", function ()
                    repeatable_goto_ai({ direction = "left", ai = "a", search_method_pair = {"cover_or_prev", "cover_or_next"} })
                end)

                vim.keymap.set({ "n", "x" }, "g]", function ()
                    repeatable_goto_ai({ direction = "right", ai = "a", search_method_pair = {"cover_or_prev", "cover_or_next"} })
                end)

                vim.keymap.set({ "n", "x" }, "g{", function ()
                    repeatable_goto_ai({ direction = "left", ai = "a", search_method_pair = {"prev", "cover_or_next"} })
                end)

                vim.keymap.set({ "n", "x" }, "g}", function ()
                    repeatable_goto_ai({ direction = "right", ai = "a", search_method_pair = {"cover_or_prev", "next"} })
                end)

                local function MiniMove(direction, ai)
                    local ok, char = pcall(vim.fn.getcharstr)
                    if not ok or char == '\27' then return nil end

                    return 'v<Cmd>lua '
                        .. string.format([[MiniAi.move_cursor('%s', '%s', '%s', { search_method = "cover" })]], direction, ai, char)
                        .. '<CR>'
                end

                vim.keymap.set({"o"}, "g[", function ()
                    return MiniMove("left", "i")
                end, { remap = true, expr = true })

                vim.keymap.set({"o"}, "g]", function ()
                    return MiniMove("right", "i")
                end, { remap = true, expr = true })

                vim.keymap.set({"o"}, "g{", function ()
                    return MiniMove("left", "a")
                end, { remap = true, expr = true })

                vim.keymap.set({"o"}, "g}", function ()
                    return MiniMove("right", "a")
                end, { remap = true, expr = true })

                local function visual_ai(opts)
                    local ai = opts.ai or 'a'
                    local search_method = opts.search_method or "cover"
                    local ok, char = pcall(vim.fn.getcharstr)
                    if not ok or char == '\27' then return nil end
                    local history = {}
                    local move, _ = ts_repeat_move.make_repeatable_move_pair(
                        function ()

                            -- mini_ai.select_textobject(ai, char, {search_method=search_method})

                            local left_reg, right_reg
                            local is_visual_mode = vim.list_contains({'v', 'V', ''}, vim.api.nvim_get_mode().mode)
                            if is_visual_mode then
                                vim.cmd.normal({ args = {vim_utils.keycodes([[<c-\><c-n>gv]])}, bang = true })
                                left_reg, right_reg = "'<", "'>"
                            else
                                left_reg, right_reg = ".", "."
                            end

                            local _, line, col = unpack(vim.fn.getpos(left_reg))
                            local from = {line = line, col = col}
                            _, line, col = unpack(vim.fn.getpos(right_reg))
                            local to = {line = line, col = col}

                            local reference_region = {from = from, to = to}

                            local selection = mini_ai.find_textobject(ai, char, {search_method=search_method, reference_region=reference_region})

                            if not selection then
                                if is_visual_mode and not vim.tbl_get(vim.b.miniai_config or {}, 'custom_textobjects', char) then
                                    table.insert(history, reference_region)
                                    vim_utils.feedkeys(ai .. char)
                                end
                                return
                            end

                            table.insert(history, reference_region)

                            vim.fn.setpos("'<", {0, selection.from.line, selection.from.col, 0})
                            vim.fn.setpos("'>", {0, selection.to.line, selection.to.col, 0})
                            vim.cmd.normal({ args = {vim_utils.keycodes([[gv]])}, bang = true })
                        end,
                        function ()
                            local selection = table.remove(history)

                            if not selection then
                                return
                            end

                            vim.fn.setpos("'<", {0, selection.from.line, selection.from.col, 0})
                            vim.fn.setpos("'>", {0, selection.to.line, selection.to.col, 0})
                            vim.cmd.normal({ args = {vim_utils.keycodes([[gv]])}, bang = true })
                        end)

                    move()
                end

                vim.keymap.set({ "x" }, "a", function () visual_ai({ ai = "a" }) end)
                vim.keymap.set({ "x" }, "i", function () visual_ai({ ai = "i" }) end)
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
        extra_contexts = {"vscode", "firenvim", "lite_mode", "ssh"},
        config = function ()
            local surround = require('mini.surround')
            local get_input = surround.user_input
            surround.setup({
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
            vim.keymap.set("n", "<leader>R", '"+gr', { remap = true })
            vim.keymap.set("n", "R", 'gr', { remap = true })
        end,
        extra_contexts = {"vscode", "firenvim", "lite_mode", "ssh"},
    }
}
