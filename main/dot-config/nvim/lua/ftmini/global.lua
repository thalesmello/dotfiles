local get_input = require('mini.surround').user_input
local ts_input = require('mini.surround').gen_spec.input.treesitter
local spec_pair = require('mini.ai').gen_spec.pair
local spec_treesitter = require('mini.ai').gen_spec.treesitter

return {
    custom_textobjects = {
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
    }
}
