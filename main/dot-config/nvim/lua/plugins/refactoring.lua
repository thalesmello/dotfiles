return {
    'ThePrimeagen/refactoring.nvim',
    dependencies = {
        {
            "nvim-lua/plenary.nvim",
            extra_contexts = {"vscode", "firenvim"}
        },
        { "nvim-treesitter/nvim-treesitter" },
    },
    opts = {},
    keys = {
        {"<leader>rf", ":Refactor<space>", mode={"n", "x"}},
    },
    cmd = "Refactor",
    extra_contexts = {"vscode", "firenvim"}
}
