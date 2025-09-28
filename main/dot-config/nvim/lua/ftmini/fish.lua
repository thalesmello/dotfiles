local get_input = require('mini.surround').user_input
local ts_input = require('mini.surround').gen_spec.input.treesitter
local spec_pair = require('mini.ai').gen_spec.pair
local spec_treesitter = require('mini.ai').gen_spec.treesitter
local argument = require('mini.ai').gen_spec.argument

return {
    custom_textobjects = {
        ["x"] = spec_treesitter({ a = "@command", i = "@command" }),
    },
    custom_surroundings = {
    }
}
