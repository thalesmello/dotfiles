return {
    "lukas-reineke/indent-blankline.nvim",
    main = "ibl",
    opts = {
        scope = {
            enabled = true,
            show_start = false,
            show_end = false,
            injected_languages = true,
            highlight = { "Function", "Label" },
            priority = 500,
        },
    },
    event = { "BufReadPost", "BufNewFile", "BufFilePost" },
}
