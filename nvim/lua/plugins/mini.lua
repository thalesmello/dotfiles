return {
    {
        'echasnovski/mini.ai',
        version = false,
        vscode = true,
        config = function()
            local spec_pair = require('mini.ai').gen_spec.pair

            require('mini.ai').setup({
                custom_textobjects = {},
                search_method = "cover",
                n_lines = 1000,
            })

            local group = vim.api.nvim_create_augroup("MiniAiBufferGroup", { clear = true })

            vim.api.nvim_create_autocmd({ 'FileType' }, {
                group = group,
                pattern = {"sql", "jinja"},
                callback = function()
                    vim.b.miniai_config = {
                        custom_textobjects = {
                            ['<c-]>'] = spec_pair('{{', '}}'),
                            ['%'] = spec_pair('{%', '%}'),
                            ['-'] = spec_pair('{%-', '-%}'),
                            ['#'] = spec_pair('{#', '#}'),
                            ['\\'] = { "}()%s-()%S?.-%S?()%s-(){" },
                        },
                    }
                end,
            })

            vim.api.nvim_create_autocmd({ 'FileType' }, {
                group = group,
                pattern = {"python"},
                callback = function()
                    vim.b.miniai_config = {
                        custom_textobjects = {
                            ['q'] = { { 'f?""".-"""', "f?'''.-'''" }, '^...%s*().-()%s*...$' },
                        },
                    }
                end,
            })
        end,
    },
    {
        "echasnovski/mini.surround",
        version = false,
        config = function ()
            local surround = require('mini.surround')
            surround.setup({
                mappings = {
                    add = 'ys',
                    delete = 'ds',
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
                        local getline = vim.fn.getline('.')
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
                pattern = {"sql", "jinja"},
                callback = function()
                    vim.b.minisurround_config = {
                        custom_surroundings = {
                            ["i"] = {
                                output = { left = "{{ ", right = " }}"},
                                input = {"{{.-}}", "^({{%s*)().-(%s*}})()$"}
                            },

                            ["%"] = {
                                output = { left = "{% ", right = " %}"},
                                input = {"{%%%-?.-%-?%%}", "^({%%%-?%s*)().-(%s*%-?%%})()"}
                            },

                            ["-"] = {
                                output = { left = "{%- ", right = " -%}"},
                                input = {"{%%%-?.-%-?%%}", "^({%%%-?%s*)().-(%s*%-?%%})()"}
                            },

                            ["#"] = {
                                output = { left = "{# ", right = " #}"},
                                input = {"{#.-#}", "^({#%s*)().-(%s*#})()"}
                            }
                        }
                    }
                end,
            })

            vim.api.nvim_create_autocmd({ 'FileType' }, {
                group = group,
                pattern = {"sql", "python"},
                callback = function()
                    vim.b.minisurround_config = {
                        custom_surroundings = {
                            ["c"] = {
                                add = function()
                                    local type = surround.user_input("Enter the type to cast to: ")
                                    if type then
                                        return { left = "CAST(" , right = " AS " .. type .. ")"  }
                                    end
                                end,
                                input = {"CAST%(.-%s+AS%s+%w-%)", "^([Cc][Aa][Ss][Tt]%(%s*)().-(%s+[Aa][Ss]%s+%w-%))()$"}
                            },

                        }
                    }
                end,
            })


            vim.api.nvim_create_autocmd({ 'FileType' }, {
                group = group,
                pattern = "lua",
                callback = function()
                    vim.b.minisurround_config = {
                        custom_surroundings = {
                            ["F"] = {
                                output = { left = "function () ", right = " end"},
                                input = ts_input({ outer = "@fundef.outer", inner = "@fundef.inner"}),
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
                    }
                end,
            })


            vim.api.nvim_create_autocmd({ 'FileType' }, {
                group = group,
                pattern = "python",
                callback = function()
                    vim.b.minisurround_config = {
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
                    }
                end,
            })
        end
    }
}
