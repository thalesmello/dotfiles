return {
    {
        'monaqa/dial.nvim',
        config = function()
            local augend = require("dial.augend")
            local config = require("dial.config")
            local map = require("dial.map")

            vim.keymap.set("n", "<C-a>", function() map.manipulate("increment", "normal") end)
            vim.keymap.set("n", "<C-x>", function() map.manipulate("decrement", "normal") end)
            vim.keymap.set("n", "g<C-a>", function() map.manipulate("increment", "gnormal") end)
            vim.keymap.set("n", "g<C-x>", function() map.manipulate("decrement", "gnormal") end)
            vim.keymap.set("v", "<C-a>", function() map.manipulate("increment", "visual") end)
            vim.keymap.set("v", "<C-x>", function() map.manipulate("decrement", "visual") end)
            vim.keymap.set("v", "g<C-a>", function() map.manipulate("increment", "gvisual") end)
            vim.keymap.set("v", "g<C-x>", function() map.manipulate("decrement", "gvisual") end)

            config.augends:register_group{
                -- default augends used when no group name is specified
                default = {
                    augend.integer.alias.decimal,
                    augend.constant.alias.bool,
                    augend.integer.alias.hex,
                    augend.date.alias["%Y-%m-%d"],
                    augend.date.alias["%m/%d/%Y"],
                    augend.date.alias["%m/%d"],
                    augend.date.alias["%H:%M"],
                },
            }
        end,
    extra_contexts = {"vscode", "firenvim"}
    },
    {
        'AndrewRadev/switch.vim',
        init = function ()
            vim.g.switch_mapping = "+"
        end,
        config = function ()
            vim.g.switch_custom_definitions = {
                vim.fn["switch#NormalizedCaseWords"]({"is", "is not"}),
            }

            local group = vim.api.nvim_create_augroup('SwitchVimGroup', { clear = true })
            vim.api.nvim_create_autocmd({ 'FileType' }, {
                group = group,
                pattern = {"python"},
                callback = function()
                    vim.b.switch_custom_definitions = {
                        {
                            [ [[f"\([^"]*\)"]] ] = [["\1"]],
                            [ [["\([^"]*\)"]] ] = [[f"\1"]],
                        },
                        {
                            [ [[f'\([^']*\)']] ] = [['\1']],
                            [ [['\([^']*\)']] ] = [[f'\1']],
                        },
                        {
                            [ [[if True or (\(.*\)):]] ]=          [[if False and (\1):]],
                            [ [[if False and (\(.*\)):]] ]=        [[if \1:]],
                            [ [[if \%(True\|False\)\@!\(.*\):]] ]= [[if True or (\1):]],
                        },
                    }
                end,
            })

            vim.api.nvim_create_autocmd({ 'FileType' }, {
                group = group,
                pattern = {"sql"},
                callback = function()
                    vim.b.switch_custom_definitions = {
                        {
                            [ [[{%\([^-].*[^-]\)%}]] ] = [[{%-\1-%}]],
                            [ [[{%-\([^-].*[^-]\)-%}]] ] = [[{%-\1%}]],
                            [ [[{%-\([^-].*[^-]\)%}]] ] = [[{%\1-%}]],
                            [ [[{%\([^-].*[^-]\)-%}]] ] = [[{%-\1-%}]],
                        },
                    }
                end,
            })
        end,
        extra_contexts = {"vscode", "firenvim"}
    }
}
