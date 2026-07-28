return {
    'ThePrimeagen/refactoring.nvim',
    dependencies = {
        { "lewis6991/async.nvim" },
        { "nvim-treesitter/nvim-treesitter" },
    },
    opts = {},
    keys = {
        {"<leader>rf", ":Refactor<space>", mode={"n", "x"}},
    },
    cmd = "Refactor",
    extra_contexts = {"vscode", "firenvim"}
}
