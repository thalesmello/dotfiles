return {
    'mhinz/vim-signify',
    config = function()
        vim.keymap.set("n", "]c", function()
            if vim.wo.diff then
                return "]c"
            else
                return "<Plug>(signify-next-hunk)"
            end
        end, { expr = true })
        vim.keymap.set("n", "[c", function()
            if vim.wo.diff then
                return "[c"
            else
                return "<Plug>(signify-prev-hunk)"
            end
        end, { expr = true })
        vim.keymap.set("o", "ih", "<Plug>(signify-motion-inner-pending)", { remap = true })
        vim.keymap.set("o", "ah", "<Plug>(signify-motion-outer-pending)", { remap = true })
        vim.keymap.set("x", "ih", "<Plug>(signify-motion-inner-visual)", { remap = true })
        vim.keymap.set("x", "ah", "<Plug>(signify-motion-outer-visual)", { remap = true })
    end,
}
