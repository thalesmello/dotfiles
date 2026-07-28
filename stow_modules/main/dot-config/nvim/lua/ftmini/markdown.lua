local get_input = require('mini.surround').user_input
local ts_input = require('mini.surround').gen_spec.input.treesitter

return {
    custom_surroundings = {
        ["l"] = {
            output = function ()
                local clipboard = vim.fn.getreg("+"):gsub("\n", "")

                return { left = "[", right = "](" .. clipboard .. ")"  }
            end,
            input = { "%b[]%b()", "^%[().-()%]%b()$" },
        },
    }
}
