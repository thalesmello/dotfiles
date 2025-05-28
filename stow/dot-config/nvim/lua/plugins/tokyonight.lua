return {
    "folke/tokyonight.nvim",
    lazy = false,
    priority = 1000,
    config = function ()
        require('tokyonight').setup()
        -- Sets the colorscheme for terminal sessions too.
        vim.opt.background = "dark"
        vim.cmd.colorscheme("tokyonight")
    end,
    extra_contexts = {"vscode", "firenvim"}
}
