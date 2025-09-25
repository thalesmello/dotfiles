local get_input = require('mini.surround').user_input
local ts_input = require('mini.surround').gen_spec.input.treesitter

local spec_pair = require('mini.ai').gen_spec.pair
local spec_treesitter = require('mini.ai').gen_spec.treesitter

return {
    custom_textobjects = {
        ["g"] = { "%[=*%[().-()%]=*%]" },
        ["G"] = { "%[=*%[%s*().-()%s*%]=*%]" },
    },
    custom_surroundings = {
        ["d"] = {
            output = { left = "function () ", right = " end"},
            input = ts_input({ outer = "@function.outer", inner = "@function.inner"}),
        },
        ["<c-f>"] = {
            output = { left = "function ()\n\treturn ", right = "\nend"},
            input = ts_input({ outer = "@function.outer", inner = "@function.inner"}),
        },
        ["g"] = {
            output = { left = "[[", right = "]]"},
            input = { "%[=*%[().-()%]=*%]" },
        },
        ["G"] = {
            output = { left = "[=[", right = "]=]"},
            input = { "%[=*%[().-()%]=*%]" },
        },
    }
}
