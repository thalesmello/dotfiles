return {
    {
        'echasnovski/mini.ai',
        version = false,
        vscode = true,
        firenvim = true,
        config = function()
            local spec_pair = require('mini.ai').gen_spec.pair
            local spec_treesitter = require('mini.ai').gen_spec.treesitter

            require('mini.ai').setup({
                custom_textobjects = {
                    ["f"] = { '%f[%w_%.][%w_%.]+%b()', '^.-%(().*()%)$' },
                    ["F"] = spec_treesitter({ a = "@function.outer", i = "@function.inner" }),
                    -- [";"] = spec_treesitter({ a = "@pair.value", i = "" }),
                    -- [":"] = spec_treesitter({ a = "@pair.key", i = "" }),
                    ["C"] = spec_treesitter({ i = "@class.inner", a = "@class.outer" }),
                    ['.'] = { "%S()%s+()[%a_][a-zA-Z0-9_%.]*(),?()[^,]" },
                },
                search_method = "cover_or_next",
                n_lines = 1000,
            })

            local group = vim.api.nvim_create_augroup("MiniAiBufferGroup", { clear = true })

            vim.api.nvim_create_autocmd({ 'FileType' }, {
                group = group,
                pattern = {"sql", "jinja", "python"},
                callback = function()
                    vim.b.miniai_config = vim.tbl_deep_extend("force", vim.b.miniai_config or {}, {
                        custom_textobjects = {
                            ['%'] = spec_pair('{%', '%}'),
                            ['-'] = spec_pair('{%-', '-%}'),
                            ['#'] = spec_pair('{#', '#}'),
                            ['\\'] = { "%%}()%s-()%S?.-%S?()%s-(){%%" },
                            ["s"] = {{
                                {"%b()",  "^.%s-()()SELECT.-()()%s*.$" },
                                { '""".-"""', "^...%s-()()SELECT.-()()%s*...$"},
                                { "'''.-'''", "^...%s-()()SELECT.-()()%s*...$"},
                                -- This is rarely used, prefer ae
                                -- Keeping it here in case I want to improve it in the future
                                -- { '.*\n.*' , "^%s-()()SELECT.-()()%s*$"},
                            }},
                            ["T"] = {"%b<>", "^<.-:().-()>"},
                        },
                    })
                end,
            })

            vim.api.nvim_create_autocmd({ 'FileType' }, {
                group = group,
                pattern = {"sql"},
                callback = function()

                    vim.b.miniai_config = vim.tbl_deep_extend("force", vim.b.miniai_config or {}, {
                        custom_textobjects = {
                            [","] = spec_treesitter({ i = "@sql-term-expr", a = "@sql-term-term" }),
                            ["S"] = { {"^[%w_].*", "[^%w_].*"}, "^[^%w_]?[%w_]*%s+[Aa][Ss]%s+%b(),?", "^.()[%w_]-%s+..%s+%(%s*().-()%s*%),?()$"},
                            ["s"] = spec_treesitter({ i = "@sql-select-inner", a = "@sql-select-statement" }),
                            ['i'] = spec_pair('{{', '}}'),
                        },
                    })
                end,
            })

            vim.api.nvim_create_autocmd({ 'FileType' }, {
                group = group,
                pattern = {"python"},
                callback = function()
                    vim.b.miniai_config = vim.tbl_deep_extend("force", vim.b.miniai_config or {}, {
                        custom_textobjects = {
                            ['q'] = { { 'f?""".-"""', "f?'''.-'''" }, '^...%s*().-()%s*...$' },
                        },
                    })
                end,
            })

            vim.api.nvim_create_autocmd({ 'FileType' }, {
                group = group,
                pattern = "lua",
                callback = function()
                    vim.b.miniai_config = vim.tbl_deep_extend("force", vim.b.miniai_config or {}, {
                        custom_textobjects = {
                            ["q"] = { "%[=*%[().-()%]=*%]" },
                            ["Q"] = { "%[=*%[%s*().-()%s*%]=*%]" },
                        }
                    })
                end,
            })

            vim.api.nvim_create_autocmd({ 'FileType' }, {
                group = group,
                pattern = {"snippets"},
                callback = function()
                    vim.b.miniai_config = vim.tbl_deep_extend("force", vim.b.miniai_config or {}, {
                        custom_textobjects = {
                            ['$'] = {"%${.-}", "^%${().-()}$"},
                        },
                    })
                end,
            })
        end,
    },
    {
        "thalesmello/mini.surround",
        version = false,
        vscode = true,
        firenvim = true,
        config = function ()
            local surround = require('mini.surround')
            surround.setup({
                mappings = {
                    add = 'ys',
                    delete = 'ds',
                    yank = '<leader>sy',
                    paste = '<leader>sp',
                    find = '<leader>sf',
                    find_left = '<leader>sF',
                    highlight = '<leader>sh',
                    replace = 'cs',
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
            vim.keymap.del('x', 'ys')
            vim.keymap.set('x', 'S', [[:<C-u>lua MiniSurround.add('visual')<CR>]], { silent = true })

            -- Make special mapping for "add surrounding for line"
            vim.keymap.set('n', 'yss', 'ys_', { remap = true })

            vim.keymap.set('i', '<c-s>', function ()
                local vim_utils = require('vim_utils')

                vim.api.nvim_create_autocmd({ 'InsertEnter' }, {
                    pattern = '*',
                    once = true,
                    callback = function()
                        local col = vim.fn.col('.')
                        -- For some reason, at cursor column there's a "<c2>" caracter
                        -- And therefore to select the character in from of the cursor I have
                        -- To use col + 1, even though end indices are inclusive in lua
                        -- I couldn't find any documentation, but I think <c2> is an internal representation
                        -- for the cursor output from getline('.')
                        local char_under_cursor = vim.fn.getline('.'):sub(1):sub(col, col+1)
                        if char_under_cursor == '§' then
                            vim_utils.feedkeys("<c-o>x")
                        end
                    end,
                })
                vim_utils.feedkeys('§<left><c-o>v:<c-u>lua require("mini.surround").add("visual")<cr>', 'n')
            end, {silent=true})


            local group = vim.api.nvim_create_augroup("MiniSurroundGroup", { clear = true })
            local ts_input = surround.gen_spec.input.treesitter

            vim.api.nvim_create_autocmd({ 'FileType' }, {
                group = group,
                pattern = {"sql", "jinja", "python"},
                callback = function()
                    vim.b.minisurround_config = vim.tbl_deep_extend("force", vim.b.minisurround_config or {}, {
                        custom_surroundings = {
                            ["i"] = {
                                output = { left = "{{ ", right = " }}"},
                                input = {"{{.-}}", "^({{%s*)().-(%s*}})()$"}
                            },

                            ["%"] = {
                                output = { left = "{% ", right = " %}"},
                                input = {"{%%%-?.-%-?%%}", "^{%%%-?%s*().-()%s*%-?%%}$"}
                            },

                            ["-"] = {
                                output = { left = "{%- ", right = " -%}"},
                                input = {"{%%%-?.-%-?%%}", "^{%%%-?%s*().-()%s*%-?%%}$"}
                            },

                            ["#"] = {
                                output = { left = "{# ", right = " #}"},
                                input = {"{#.-#}", "^{#%s*().-()%s*#}"}
                            },

                            ["c"] = {
                                output = function()
                                    local type = surround.user_input("Enter the type to cast to: ")
                                    if type then
                                        return { left = "CAST(" , right = " AS " .. type .. ")"  }
                                    end
                                end,
                                input = {"[Cc][Aa][Ss][Tt]%b()", "^....%(().-()%s+[Aa][Ss]%s+.-%)$"}
                            },

                            ["S"] = {
                                input = ts_input({ outer = "@sql-cte-cte", inner = "@sql-cte-inner"}),
                                output = function ()
                                    local cte_name = MiniSurround.user_input("CTE name: ")

                                    return { left = cte_name .. " AS (\n", right = "\n)," }
                                end
                            },

                            ["T"] = {
                                output = function ()
                                    local tag = MiniSurround.user_input("Enter tag: ")

                                    return { left = "<".. tag .. ':', right = ">" }
                                end,
                                input = {"%b<>", "^<.-:().-()>"}
                            },
                        }
                    })
                end,
            })

            vim.api.nvim_create_autocmd({ 'FileType' }, {
                group = group,
                pattern = {"markdown"},
                callback = function()
                    vim.b.minisurround_config = vim.tbl_deep_extend("force", vim.b.minisurround_config or {}, {
                        custom_surroundings = {
                            ["l"] = {
                                output = function ()
                                    local clipboard = vim.fn.getreg("+"):gsub("\n", "")

                                    return { left = "[", right = "](" .. clipboard .. ")"  }
                                end,
                                input = { "%b[]%b()", "^%[().-()%]%b()$" },
                            },
                        }
                    })
                end,
            })


            vim.api.nvim_create_autocmd({ 'FileType' }, {
                group = group,
                pattern = "lua",
                callback = function()
                    vim.b.minisurround_config = vim.tbl_deep_extend("force", vim.b.minisurround_config or {}, {
                        custom_surroundings = {
                            ["F"] = {
                                output = { left = "function () ", right = " end"},
                                input = ts_input({ outer = "@function.outer", inner = "@function.inner"}),
                            },
                            ["<c-f>"] = {
                                output = { left = "function ()\n\treturn ", right = "\nend"},
                                input = ts_input({ outer = "@function.outer", inner = "@function.inner"}),
                            },
                            ["q"] = {
                                output = { left = "[[", right = "]]"},
                                input = { "%[=*%[().-()%]=*%]" },
                            },
                            ["Q"] = {
                                output = { left = "[=[", right = "]=]"},
                                input = { "%[=*%[().-()%]=*%]" },
                            },
                        }
                    })
                end,
            })


            vim.api.nvim_create_autocmd({ 'FileType' }, {
                group = group,
                pattern = "python",
                callback = function()
                    vim.b.minisurround_config = vim.tbl_deep_extend("force", vim.b.minisurround_config or {}, {
                        custom_surroundings = {
                            ["q"] = {
                                output = { left = '"""', right = '"""'},
                                input = { { 'f?""".-"""', "f?'''.-'''" }, '^...%s*().-()%s*...$' },
                            },
                            ["Q"] = {
                                output = { left = "'''", right = "'''"},
                                input = { { 'f?""".-"""', "f?'''.-'''" }, '^...%s*().-()%s*...$' },
                            },
                            ["="] = {
                                output = { left = "", right = "="},
                                input = {[=[[%w_]+%s-=%s*]=], [=[^()[%w_]+()%s*=$]=]}
                            },
                            ["+"] = {
                                output = { left = "", right = " = "},
                                input = {[=[[%w_]+%s-=%s*]=], [=[^()[%w_]+()%s-=%s-$]=]}
                            },
                            [":"] = {
                                output = { left = '"', right = '": '},
                                input = {[=[['"][%w_]+['"]%s-:%s+]=], [=[^['"]()[%w_]+()['"]%s-:%s-$]=]}
                            },
                        }
                    })
                end,
            })

            vim.api.nvim_create_autocmd({ 'FileType' }, {
                group = group,
                pattern = {"snippets"},
                callback = function()
                    vim.b.minisurround_config = vim.tbl_deep_extend("force", vim.b.minisurround_config or {}, {
                        custom_surroundings = {
                            ["$"] = {
                                output = { left = "${", right = "}"},
                                input = {"%${.-}", "^%${().-()}$"}
                            },
                        }
                    })
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
                prefix = 'gp',

                -- Whether to reindent new text to match previous indent
                reindent_linewise = true,
            },

            -- Sort text
            sort = {
                prefix = 'gs',

                -- Function which does the sort
                func = nil,
            }
        },
        vscode = true,
        firenvim = true,
    }
}
