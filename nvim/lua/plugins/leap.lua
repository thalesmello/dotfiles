return {
    'ggandor/leap.nvim',
    dependencies = {
        'ggandor/leap-spooky.nvim',
    },
    config = function()
        require('config/leap')
    end,
    keys = {
        {"s", "<Plug>(leap-forward)", mode = { "n" }, desc = "Leap forward to"},
        {"S", "<Plug>(leap-backward)", mode = { "n" }, desc = "Leap backward to"},
        {"gs", "<Plug>(leap-from-window)", mode = { "n" }, desc = "Leap from windows"},
        {"s", "<Plug>(leap-forward-to)", mode = { "x" }, desc = "Leap operator inclusive"},
        {"gs", "<Plug>(leap-backward-to)", mode = { "x" }, desc = "Leap backwards operator inclusive"},
        {"z", "<Plug>(leap-forward-to)", mode = { "o" }, desc = "Leap operator inclusive"},
        {"Z", "<Plug>(leap-backward-to)", mode = { "o" }, desc = "Leap backwards operator inclusive"},
        {"x", "<Plug>(leap-forward-till)", mode = { "o" }, desc = "Leap operator non-inclusive"},
        {"X", "<Plug>(leap-backward-till)", mode = { "o" }, desc = "Leap backwards operator inclusive"},
    },
    vscode = true,
}
