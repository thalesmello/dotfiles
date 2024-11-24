return {
    'ThePrimeagen/refactoring.nvim',
    dependencies = {
        { "nvim-lua/plenary.nvim", vscode = true, firenvim = true },
        { "nvim-treesitter/nvim-treesitter" },
    },
    opts = {},
    keys = {
        {"<leader>rf", ":Refactor<space>", mode={"n", "x"}},
    },
    cmd = "Refactor",
    firenvim = true,
    vscode = true,
}
