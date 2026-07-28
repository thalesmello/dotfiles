local get_input = require('mini.surround').user_input
local ts_input = require('mini.surround').gen_spec.input.treesitter
local spec_pair = require('mini.ai').gen_spec.pair
local spec_treesitter = require('mini.ai').gen_spec.treesitter

return {
    custom_textobjects = {
        ['g'] = {
            { 'f?""".-"""', "f?'''.-'''" },
            '^...%s*().-()%s*...$',
        },
        ['"'] = {
            '%f[f"]f?%b""',
            '^f?.().-().$',
        },
        ["'"] = {
            "%f[f']f?%b''",
            '^f?.().-().$',
        },
        ["q"] = {
            { "%f[f']f?%b''", '%f[f"]f?%b""' },
            '^f?.().-().$',
        },
    },
    custom_surroundings = {
        ["g"] = {
            output = { left = '"""', right = '"""'},
            input = { { 'f?""".-"""', "f?'''.-'''" }, '^...%s*().-()%s*...$' },
        },
        ["G"] = {
            output = { left = "'''", right = "'''"},
            input = { { 'f?""".-"""', "f?'''.-'''" }, '^...%s*().-()%s*...$' },
        },
        -- Unused objects
        -- ["="] = {
        --     output = { left = "", right = "="},
        --     input = {[=[[%w_]+%s-=%s*]=], [=[^()[%w_]+()%s*=$]=]}
        -- },
        -- ["+"] = {
        --     output = { left = "", right = " = "},
        --     input = {[=[[%w_]+%s-=%s*]=], [=[^()[%w_]+()%s-=%s-$]=]}
        -- },
        -- [":"] = {
        --     output = { left = '"', right = '": '},
        --     input = {[=[['"][%w_]+['"]%s-:%s+]=], [=[^['"]()[%w_]+()['"]%s-:%s-$]=]}
        -- },
    }
}
