local get_input = require('mini.surround').user_input
local ts_input = require('mini.surround').gen_spec.input.treesitter
local spec_pair = require('mini.ai').gen_spec.pair
local spec_treesitter = require('mini.ai').gen_spec.treesitter

return {
    custom_textobjects = {
        ['.'] = { { "[^a-zA-Z0-9_%.]%s*[%a_][a-zA-Z0-9_%.]*,?", "^%s*()[%a_][a-zA-Z0-9_%.]*,?" }, "^[^a-zA-Z0-9_%.]?()%s*()[%a_][a-zA-Z0-9_%.]*(),?()$" },
        ["f"] = { '%f[%w_%.][%w_%.]+%b()', '^.-%(().*()%)$' },
        ["d"] = spec_treesitter({ a = "@function.outer", i = "@function.inner" }),
        -- [";"] = spec_treesitter({ a = "@pair.value", i = "" }),
        -- [":"] = spec_treesitter({ a = "@pair.key", i = "" }),
        ["C"] = spec_treesitter({ i = "@class.inner", a = "@class.outer" }),
    },
    custom_surroundings = {
        ['f'] = {
            input = { '%f[%w_%.][%w_%.]+%b()', '^.-%(().*()%)$' },
            output = function()
                local fun_name = MiniSurround.user_input('Function name')
                if fun_name == nil then return nil end
                return { left = ('%s('):format(fun_name), right = ')' }
            end,
        },
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
    }
}
