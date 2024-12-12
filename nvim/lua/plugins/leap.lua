return {
    'ggandor/leap.nvim',
    dependencies = {
        'ggandor/leap-spooky.nvim',
    },
    keys = {
        {"s", "<Plug>(leap-forward)", mode = { "n" }, desc = "Leap forward to"},
        {"S", "<Plug>(leap-backward)", mode = { "n" }, desc = "Leap backward to"},
        {"gs", "<Plug>(leap-from-window)", mode = { "n" }, desc = "Leap from windows"},
        {"s", "<Plug>(leap-forward-to)", mode = { "x" }, desc = "Leap operator inclusive"},
        {"gz", "<Plug>(leap-backward-to)", mode = { "x" }, desc = "Leap backwards operator inclusive"},
        {"z", "<Plug>(leap-forward-to)", mode = { "o" }, desc = "Leap operator inclusive"},
        {"Z", "<Plug>(leap-backward-to)", mode = { "o" }, desc = "Leap backwards operator inclusive"},
        {"x", "<Plug>(leap-forward-till)", mode = { "o" }, desc = "Leap operator non-inclusive"},
        {"X", "<Plug>(leap-backward-till)", mode = { "o" }, desc = "Leap backwards operator inclusive"},
        {"r", mode = "o"},
        {"R", mode = "o"},
    },
    config = function ()
        require('leap-spooky').setup {
            -- Additional text objects, to be merged with the default ones.
            -- E.g.: {'iq', 'aq'}
            extra_text_objects = {"af", "if", "aF", "iF", "ii", "ai", "aI", "iI", "im", "am"},
            -- extra_text_objects = nil,
            -- Mappings will be generated corresponding to all native text objects,
            -- like: (ir|ar|iR|aR|im|am|iM|aM){obj}.
            -- Special line objects will also be added, by repeating the affixes.
            -- E.g. `yrr<leap>` and `ymm<leap>` will yank a line in the current
            -- window.
            affixes = {
                -- The cursor moves to the targeted object, and stays there.
                -- magnetic = { window = 'm', cross_window = 'M' },
                -- The operation is executed seemingly remotely (the cursor boomerangs
                -- back afterwards).
                remote = { window = 'r', cross_window = 'R' },
            },
            -- Defines text objects like `riw`, `raw`, etc., instead of
            -- targets.vim-style `irw`, `arw`. (Note: prefix is forced if a custom
            -- text object does not start with "a" or "i".)
            prefix = true,
            -- The yanked text will automatically be pasted at the cursor position
            -- if the unnamed register is in use.
            paste_on_remote_yank = false,
        }
    end,
    extra_contexts = {"vscode", "firenvim"}
}
