return {
    'machakann/vim-highlightedyank',
    config = function()
        vim.g.highlightedyank_highlight_duration = 200
    end,
    event = "TextYankPost",
    extra_contexts = {"vscode", "firenvim", "lite_mode", "ssh"}
}
