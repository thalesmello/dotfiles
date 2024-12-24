local get_input = require('mini.surround').user_input
local ts_input = require('mini.surround').gen_spec.input.treesitter
local spec_pair = require('mini.ai').gen_spec.pair
local spec_treesitter = require('mini.ai').gen_spec.treesitter

return {
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
                local type = get_input("Enter the type to cast to: ")
                if type then
                    return { left = "CAST(" , right = " AS " .. type .. ")"  }
                end
            end,
            input = {"[Cc][Aa][Ss][Tt]%b()", "^....%(().-()%s+[Aa][Ss]%s+.-%)$"}
        },

        ["S"] = {
            input = ts_input({ outer = "@sql-cte-cte", inner = "@sql-cte-inner"}),
            output = function ()
                local cte_name = get_input("CTE name: ")

                return { left = cte_name .. " AS (\n", right = "\n)," }
            end
        },

        ["T"] = {
            output = function ()
                local tag = get_input("Enter tag: ")

                return { left = "<".. tag .. ':', right = ">" }
            end,
            input = {"%b<>", "^<.-:().-()>"}
        },
    }
}
