local surround_adapter = require("surround_adapter")
return {
    'kylechui/nvim-surround',
    dependencies = {
        'nvim-treesitter/nvim-treesitter',
        'kana/vim-textobj-user',
    },
    config = function()
        local surround = require('nvim-surround')
        local get_input = surround_adapter.user_input

        surround.setup({
            surrounds = {
                ['?'] = surround_adapter.from_mini({
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
                }),
            },
            keymaps = {
                insert = "<c-s>",
                insert_line = "<C-s><c-s>",
            },
            -- surrounds =     -- Defines surround keys and behavior
            aliases = {
                ["a"] = false,
                ["b"] = false,
                ["B"] = false,
                ["r"] = false,
                ["q"] = false,
                ["s"] = false,
            },
            -- highlight =     -- Defines highlight behavior
            move_cursor = true,
            -- indent_lines =  -- Defines line indentation behavior,
        })



        local group = vim.api.nvim_create_augroup("MiniSurroundConfigGroup", { clear = true })
        local ts_input = surround_adapter.input_treesitter

        vim.api.nvim_create_autocmd({ 'FileType' }, {
            group = group,
            pattern = {"sql", "jinja", "python"},
            callback = function()
                surround.buffer_setup({
                    surrounds = {
                        ["i"] = surround_adapter.from_mini({
                            output = { left = "{{ ", right = " }}"},
                            input = {"{{.-}}", "^({{%s*)().-(%s*}})()$"}
                        }),

                        ["%"] = surround_adapter.from_mini({
                            output = { left = "{% ", right = " %}"},
                            input = {"{%%%-?.-%-?%%}", "^{%%%-?%s*().-()%s*%-?%%}$"}
                        }),

                        ["-"] = surround_adapter.from_mini({
                            output = { left = "{%- ", right = " -%}"},
                            input = {"{%%%-?.-%-?%%}", "^{%%%-?%s*().-()%s*%-?%%}$"}
                        }),

                        ["#"] = surround_adapter.from_mini({
                            output = { left = "{# ", right = " #}"},
                            input = {"{#.-#}", "^{#%s*().-()%s*#}"}
                        }),

                        ["c"] = surround_adapter.from_mini({
                            output = function()
                                local type = surround.user_input("Enter the type to cast to: ")
                                if type then
                                    return { left = "CAST(" , right = " AS " .. type .. ")"  }
                                end
                            end,
                            input = {"[Cc][Aa][Ss][Tt]%b()", "^....%(().-()%s+[Aa][Ss]%s+.-%)$"}
                        }),

                        ["S"] = surround_adapter.from_mini({
                            input = ts_input({ outer = "@sql-cte-cte", inner = "@sql-cte-inner"}),
                            output = function ()
                                local cte_name = get_input("CTE name: ")

                                return { left = cte_name .. " AS (\n", right = "\n)," }
                            end
                        }),

                        ["T"] = surround_adapter.from_mini({
                            output = function ()
                                local tag = get_input("Enter tag: ")

                                return { left = "<".. tag .. ':', right = ">" }
                            end,
                            input = {"%b<>", "^<.-:().-()>"}
                        }),
                    }
                })
            end,
        })

        vim.api.nvim_create_autocmd({ 'FileType' }, {
            group = group,
            pattern = {"markdown"},
            callback = function()
                surround.buffer_setup({
                    surrounds = {
                        ["l"] = surround_adapter.from_mini({
                            output = function ()
                                local clipboard = vim.fn.getreg("+"):gsub("\n", "")

                                return { left = "[", right = "](" .. clipboard .. ")"  }
                            end,
                            input = { "%b[]%b()", "^%[().-()%]%b()$" },
                        }),
                    }
                })
            end,
        })


        vim.api.nvim_create_autocmd({ 'FileType' }, {
            group = group,
            pattern = "lua",
            callback = function()
                surround.buffer_setup({
                    surrounds = {
                        ["F"] = surround_adapter.from_mini({
                            output = { left = "function () ", right = " end"},
                            input = ts_input({ outer = "@function.outer", inner = "@function.inner"}),
                        }),
                        ["<c-f>"] = surround_adapter.from_mini({
                            output = { left = "function ()\n\treturn ", right = "\nend"},
                            input = ts_input({ outer = "@function.outer", inner = "@function.inner"}),
                        }),
                        ["q"] = surround_adapter.from_mini({
                            output = { left = "[[", right = "]]"},
                            input = { "%[=*%[().-()%]=*%]" },
                        }),
                        ["Q"] = surround_adapter.from_mini({
                            output = { left = "[=[", right = "]=]"},
                            input = { "%[=*%[().-()%]=*%]" },
                        }),
                    }
                })
            end,
        })


        vim.api.nvim_create_autocmd({ 'FileType' }, {
            group = group,
            pattern = "python",
            callback = function()
                surround.buffer_setup({
                    surrounds = {
                        ["q"] = surround_adapter.from_mini({
                            output = { left = '"""', right = '"""'},
                            input = { { 'f?""".-"""', "f?'''.-'''" }, '^...%s*().-()%s*...$' },
                        }),
                        ["Q"] = surround_adapter.from_mini({
                            output = { left = "'''", right = "'''"},
                            input = { { 'f?""".-"""', "f?'''.-'''" }, '^...%s*().-()%s*...$' },
                        }),
                        ["="] = surround_adapter.from_mini({
                            output = { left = "", right = "="},
                            input = {[=[[%w_]+%s-=%s*]=], [=[^()[%w_]+()%s*=$]=]}
                        }),
                        ["+"] = surround_adapter.from_mini({
                            output = { left = "", right = " = "},
                            input = {[=[[%w_]+%s-=%s*]=], [=[^()[%w_]+()%s-=%s-$]=]}
                        }),
                        [":"] = surround_adapter.from_mini({
                            output = { left = '"', right = '": '},
                            input = {[=[['"][%w_]+['"]%s-:%s+]=], [=[^['"]()[%w_]+()['"]%s-:%s-$]=]}
                        }),
                    }
                })
            end,
        })

        vim.api.nvim_create_autocmd({ 'FileType' }, {
            group = group,
            pattern = {"snippets"},
            callback = function()
                surround.buffer_setup({
                    surrounds = {
                        ["$"] = surround_adapter.from_mini({
                            output = { left = "${", right = "}"},
                            input = {"%${.-}", "^%${().-()}$"}
                        }),
                    }
                })
            end,
        })
    end,
    cond = true,
    extra_contexts = {"vscode", "firenvim"}
}
