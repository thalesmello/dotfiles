return {
    {
        'ggandor/leap.nvim',
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
        extra_contexts = {"vscode", "firenvim"}
    },
    {
        'rasulomaroff/telepath.nvim',
        dependencies = 'ggandor/leap.nvim',
        keys = {
            { 'r', function() require('telepath').remote { restore = true } end, mode = 'o' },
            { 'R', function() require('telepath').remote { restore = true, recursive = true } end, mode = 'o' },
            { 'm', function() require('telepath').remote() end, mode = 'o' },
            { 'M', function() require('telepath').remote { recursive = true } end, mode = 'o' }
        },
        extra_contexts = {"vscode", "firenvim"}
    }
}
