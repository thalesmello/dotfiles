return {
    -- {
    --     "folke/tokyonight.nvim",
    --     lazy = false,
    --     priority = 1000,
    --     config = function ()
    --         require('tokyonight').setup()
    --         -- Sets the colorscheme for terminal sessions too.
    --         vim.opt.background = "dark"
    --         vim.cmd.colorscheme("tokyonight")
    --     end,
    --     extra_contexts = {"firenvim"}
    -- },
    {
        "catppuccin/nvim",
        name = "catppuccin",
        lazy = false,
        priority = 1000,
        config = function ()
            require('catppuccin').setup({
                flavour = "frappe",
                term_colors = true,
                background = {
                    dark = "frappe",
                    light = "latte",
                },
                styles = {
                    comments = { "italic" },
                    keywords = { "italic" },
                    conditionals = { "italic" },
                },
            })

            vim.opt.background = "dark"
            vim.cmd.colorscheme("catppuccin")
        end,
        extra_contexts = {"firenvim", "lite_mode", "ssh"}
    },
    -- {
    --     "rebelot/kanagawa.nvim",
    --     lazy = false,
    --     priority = 1000,
    --     config = function ()
    --         require('kanagawa').setup({
    --             compile = false,             -- enable compiling the colorscheme
    --             undercurl = true,            -- enable undercurls
    --             commentStyle = { italic = true },
    --             functionStyle = {},
    --             keywordStyle = { italic = true},
    --             statementStyle = { bold = true },
    --             typeStyle = {},
    --             transparent = false,         -- do not set background color
    --             dimInactive = false,         -- dim inactive window `:h hl-NormalNC`
    --             terminalColors = true,       -- define vim.g.terminal_color_{0,17}
    --             colors = {                   -- add/modify theme and palette colors
    --                 palette = {},
    --                 theme = { wave = {}, lotus = {}, dragon = {}, all = {} },
    --             },
    --             overrides = function(colors) -- add/modify highlights
    --                 return {}
    --             end,
    --             theme = "wave",              -- Load "wave" theme
    --             background = {               -- map the value of 'background' option to a theme
    --                 dark = "wave",           -- try "dragon" !
    --                 light = "lotus"
    --             },
    --         })
    --
    --         -- setup must be called before loading
    --         vim.opt.background = "dark"
    --         vim.cmd.colorscheme("kanagawa")
    --     end,
    --     extra_contexts = {"firenvim", "lite_mode", "ssh"}
    -- }
 }
