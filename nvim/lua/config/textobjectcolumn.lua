vim.g.skip_default_textobj_word_column_mappings = 1
vim.keymap.set({ "o", "x" }, 'ak', ':<C-u>call TextObjWordBasedColumn("aw")<cr>', { noremap = true })
vim.keymap.set({ "o", "x" }, 'aK', ':<C-u>call TextObjWordBasedColumn("aW")<cr>', { noremap = true })
vim.keymap.set({ "o", "x" }, 'ik', ':<C-u>call TextObjWordBasedColumn("iw")<cr>', { noremap = true })
vim.keymap.set({ "o", "x" }, 'iK', ':<C-u>call TextObjWordBasedColumn("iW")<cr>', { noremap = true })
