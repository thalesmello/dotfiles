local get_input = require('mini.surround').user_input
local ts_input = require('mini.surround').gen_spec.input.treesitter
local spec_pair = require('mini.ai').gen_spec.pair
local spec_treesitter = require('mini.ai').gen_spec.treesitter

return {
    custom_textobjects = {
        ['i'] = spec_pair('{{', '}}'),
        ['%'] = spec_pair('{%', '%}'),
        ['-'] = spec_pair('{%-', '-%}'),
        ['#'] = spec_pair('{#', '#}'),
        ['\\'] = { "%%}()%s-()%S?.-%S?()%s-(){%%" },
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

        ["T"] = {
            output = function ()
                local tag = get_input("Enter tag: ")

                return { left = "<".. tag .. ':', right = ">" }
            end,
            input = {"%b<>", "^<.-:().-()>"}
        },
    }
}
