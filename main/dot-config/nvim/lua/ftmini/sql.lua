local spec_pair = require('mini.ai').gen_spec.pair
local ts_input = require('mini.surround').gen_spec.input.treesitter
local spec_treesitter = require('mini.ai').gen_spec.treesitter
local get_input = require('mini.surround').user_input

return {
    custom_textobjects = {
        ["s"] = spec_treesitter({ i = "@sql-select-inner", a = "@sql-select-inner" }),
        ["S"] = spec_treesitter({ i = "@sql-select-statement", a = "@sql-select-statement" }),
        ["x"] = spec_treesitter({ i = "@sql-term-expr", a = "@sql-term-term" }),
        -- CTE text obj
        ["C"] = { {"^[%w_].*", "[^%w_].*"}, "^[^%w_]-[%w_]+%s+[Aa][Ss]%s+%b(),?", "^.()[%w_]-%s+..%s+%(%s*().-()%s*%),?()$"},
        -- ["C"] = spec_treesitter({ a = "@sql-cte-cte", i = "@sql-cte-inner"}),
        ["c"] = {"[Cc][Aa][Ss][Tt]%b()", "^....%(().-()%s+[Aa][Ss]%s+.-%)$"},
    },

    custom_surroundings = {
        ["C"] = {
            input = ts_input({ outer = "@sql-cte-cte", inner = "@sql-cte-inner"}),
            output = function ()
                local cte_name = get_input("CTE name: ")

                return { left = cte_name .. " AS (\n", right = "\n)," }
            end
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
    }
}
