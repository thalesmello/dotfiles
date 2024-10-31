return {
    "anuvyklack/pretty-fold.nvim",
    enabled = false,
    -- event = "VeryLazy",
    config = function()
        local components = require('pretty-fold.components')
        require('pretty-fold').setup({
            -- fill_char = ' ',
            sections = {

                left = {
                    function (config)
                        local content = components.content(config) ---@type string

                        if content:match(config.fill_char .. '*%s*{%.%.%.}') then
                            local line_num = vim.fn.nextnonblank(vim.v.foldstart + 1)
                            local next_line = vim.fn.trim(vim.fn.getline(line_num))
                            content = content:gsub('%.%.%.', next_line .. ' ...')
                        end

                        return content
                    end
                },
                right = {
                    ' ', 'number_of_folded_lines', ': ', 'percentage', ' ',
                    function(config) return config.fill_char:rep(3) end
                }
            }
        })
        require('pretty-fold').ft_setup('lua', {
            matchup_patterns = {
                { '^%s*do$', 'end' }, -- do ... end blocks
                { '^%s*if', 'end' },  -- if ... end
                { '^%s*for', 'end' }, -- for
                { 'function%s*%(', 'end' }, -- 'function( or 'function (''
                {  '{', '}' },
                { '%(', ')' }, -- % to escape lua pattern char
                { '%[', ']' }, -- % to escape lua pattern char
            },
        })
    end,
}
