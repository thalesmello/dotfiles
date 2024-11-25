return {
    {
        'kana/vim-textobj-user',
        dependencies = {
            { 'michaeljsmith/vim-indent-object' },
            { 'thalesmello/vim-textobj-methodcall' },
            {
                'glts/vim-textobj-comment',
                init = function ()
                    vim.g.textobj_comment_no_default_key_mappings = 1
                end,
                config = function ()
                    vim.keymap.set({ "x", "o" }, 'ac', "<Plug>(textobj-comment-a)", { remap = true })
                    vim.keymap.set({ "x", "o" }, 'ic', "<Plug>(textobj-comment-i)", { remap = true })
                end
            },
            { 'Julian/vim-textobj-variable-segment' },
            { 'kana/vim-textobj-entire' },
            { 'thalesmello/vim-textobj-bracketchunk' },
            -- Only works vim treesitter syntax, doesn't work with Tree sitter yet
            -- { 'thalesmello/vim-textobj-multiline-str' },
        },
        vscode = true,
        firenvim = true,
    },
    {
        "PeterRincker/vim-argumentative",
        init = function ()
            vim.g.argumentative_no_mappings = 1
        end,
        config = function ()
            vim.api.nvim_create_autocmd({ 'BufEnter' }, {
                group = vim.api.nvim_create_augroup('ArgumentativeGroup', { clear = true }),
                pattern = {"*"},
                callback = function()
                    -- List of files not to load settings
                    if vim.list_contains({"sql"}, vim.o.filetype) then
                        return
                    end

                    vim.keymap.set( "n", "[,", "<Plug>Argumentative_Prev", { buffer = true, remap = true })
                    vim.keymap.set("n", "],", "<Plug>Argumentative_Next", { buffer = true, remap = true })
                    vim.keymap.set("x", "[,", "<Plug>Argumentative_XPrev", { buffer = true, remap = true })
                    vim.keymap.set("x", "],", "<Plug>Argumentative_XNext", { buffer = true, remap = true })
                    vim.keymap.set("n", "<,", "<Plug>Argumentative_MoveLeft", { buffer = true, remap = true })
                    vim.keymap.set("n", ">,", "<Plug>Argumentative_MoveRight", { buffer = true, remap = true })
                    vim.keymap.set("x", "i,", "<Plug>Argumentative_InnerTextObject", { buffer = true, remap = true })
                    vim.keymap.set("x", "a,", "<Plug>Argumentative_OuterTextObject", { buffer = true, remap = true })
                    vim.keymap.set("o", "i,", "<Plug>Argumentative_OpPendingInnerTextObject", { buffer = true, remap = true })
                    vim.keymap.set("o", "a,", "<Plug>Argumentative_OpPendingOuterTextObject", { buffer = true, remap = true })
                end,
            })
        end
    },
    {
        'coderifous/textobj-word-column.vim',
        init = function() require('config/textobjectcolumn') end,
        vscode = true,
        firenvim = true,
    },
}
