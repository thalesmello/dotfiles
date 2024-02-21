vim.g.winresizer_start_key = '<leader>wr'
vim.g.winresizer_keycode_left = 72
vim.g.winresizer_keycode_right = 76
vim.g.winresizer_keycode_down = 74
vim.g.winresizer_keycode_up = 75
vim.keymap.set("n", "<leader>H", '<leader>wrH', { remap = true })
vim.keymap.set("n", "<leader>J", '<leader>wrJ', { remap = true })
vim.keymap.set("n", "<leader>K", '<leader>wrK', { remap = true })
vim.keymap.set("n", "<leader>L", '<leader>wrL', { remap = true })

