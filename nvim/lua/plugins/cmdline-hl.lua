return {
    {
        -- Disabling because I suspect this makes nvim very slow
        enabled = false,
        'Sam-programs/cmdline-hl.nvim',
        -- Add vim-rsi as dependenci so it's possible to overwrite <c-f>
        dependencies = {'tpope/vim-rsi'},
        event = 'VimEnter',
        config = function()
            local cmdline_hl = require('cmdline-hl')
            cmdline_hl.setup({
                -- custom prefixes for builtin-commands
                type_signs = {
                    [":"] = { " ", "Title" },
                    ["/"] = { " ", "Title" },
                    ["?"] = { " ", "Title" },
                    ["="] = { " ", "Title" },
                },
                -- custom formatting/highlight for commands
                custom_types = {
                    -- ["command-name"] = {
                    -- [icon],[icon_hl], default to `:` icon and highlight
                    -- [lang], defaults to vim
                    -- [showcmd], defaults to false
                    -- [pat], defaults to "%w*%s*(.*)"
                    -- [code], defaults to nil
                    -- }
                    -- lang is the treesitter language to use for the commands
                    -- showcmd is true if the command should be displayed or to only show the icon
                    -- pat is used to extract the part of the command that needs highlighting
                    -- the part is matched against the raw command you don't need to worry about ranges
                    -- e.g. in '<,>'s/foo/bar/
                    -- pat is checked against s/foo/bar
                    -- you could also use the 'code' function to extract the part that needs highlighting
                    ["="] = { pat = "=(.*)", lang = "lua", show_cmd = true },
                    ["help"] = { icon = "? " , show_cmd = true},
                    ["substitute"] = { pat = "%w(.*)", lang = "regex", show_cmd = true },
                    --["="] = false, -- set an option  to false to disable it
                },
                aliases = {
                    -- str is unmapped keys do with that knowledge what you will
                    -- read aliases.md for examples
                    -- ["cd"] = { str = "Cd" },
                },
                -- vim.ui.input() vim.fn.input etc
                input_hl = "Title",
                -- you can use this to format input like the type_signs table
                input_format = function(input) return input end,
                -- used to highlight the range in the command e.g. '<,>' in '<,>'s
                range_hl = "Constant",
                ghost_text = true,
                ghost_text_hl = "Comment",
                inline_ghost_text = false,
                -- history works like zsh-autosuggest you can complete it by pressing <up>
                ghost_text_provider = require("cmdline-hl.ghost_text").history,
                -- you can also use this to get the wildmenu(default completion)'s suggestion
                -- ghost_text_provider = require("cmdline-hl.ghost_text").wildmenu,
                })


            vim.keymap.set("c", "<right>", function ()
                -- Completes ghost text when autosuggest is visible
                local cmdpos = vim.fn.getcmdpos()
                local cmdval = vim.fn.getcmdline()
                if (
                    cmdpos > vim.fn.strlen(cmdval)
                    and #require('cmdline-hl').config.ghost_text_provider(':', cmdval, cmdpos) > 0
                ) then
                    return "<Up>"
                else
                    return "<Right>"
                end
            end, {expr = true})
            vim.keymap.set("c", "<c-f>", function ()
                -- Completes ghost text when autosuggest is visible
                local cmdpos = vim.fn.getcmdpos()
                local cmdval = vim.fn.getcmdline()
                if cmdpos > vim.fn.strlen(cmdval) then
                    if #cmdval > 0 and #require('cmdline-hl').config.ghost_text_provider(':', cmdval, cmdpos) > 0 then
                        return "<up>"
                    else
                        return vim.o.cedit
                    end
                else
                    return "<right>"
                end
            end, {expr = true, remap = false})
        end
    }
}
