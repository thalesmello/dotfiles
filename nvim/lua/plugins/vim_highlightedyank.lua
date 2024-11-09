return {
    'machakann/vim-highlightedyank',
    config = function() require('config/highlightedyank') end,
    event = "TextYankPost",
    firenvim = true,
    vscode = true,
}
