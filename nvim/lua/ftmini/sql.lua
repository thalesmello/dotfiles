local spec_pair = require('mini.ai').gen_spec.pair
local spec_treesitter = require('mini.ai').gen_spec.treesitter

return {
    custom_textobjects = {
        [","] = spec_treesitter({ i = "@sql-term-expr", a = "@sql-term-term" }),
        ["S"] = { {"^[%w_].*", "[^%w_].*"}, "^[^%w_]-[%w_]+%s+[Aa][Ss]%s+%b(),?", "^.()[%w_]-%s+..%s+%(%s*().-()%s*%),?()$"},
        ["s"] = spec_treesitter({ i = "@sql-select-inner", a = "@sql-select-statement" }),
        ['i'] = spec_pair('{{', '}}'),
    },
}
