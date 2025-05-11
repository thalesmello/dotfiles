return {
    {
        'michaeljsmith/vim-indent-object',
        enabled = false,
    },
    {
        'kana/vim-textobj-user',
        enabled = false,
        dependencies = {
            {'thalesmello/vim-textobj-methodcall'},
            {
                'glts/vim-textobj-comment',
                init = function () vim.g.textobj_comment_no_default_key_mappings = 1 end,
                config = function ()
                    vim.keymap.set({ "x", "o" }, 'ac', "<Plug>(textobj-comment-a)", { remap = true })
                    vim.keymap.set({ "x", "o" }, 'ic', "<Plug>(textobj-comment-i)", { remap = true }) end
            },
            { 'Julian/vim-textobj-variable-segment' },
            { 'kana/vim-textobj-entire' },
            { 'thalesmello/vim-textobj-bracketchunk' },
            -- Only works vim treesitter syntax, doesn't work with Tree sitter yet
            -- { 'thalesmello/vim-textobj-multiline-str' },
        },
        extra_contexts = {"vscode", "firenvim"}
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
        end,
        extra_contexts = {"vscode", "firenvim"}
    },
    {
        'coderifous/textobj-word-column.vim',
        enabled = false,
        init = function()
            vim.g.skip_default_textobj_word_column_mappings = 1
            vim.keymap.set({ "o", "x" }, 'ak', ':<C-u>call TextObjWordBasedColumn("aw")<cr>', { noremap = true })
            vim.keymap.set({ "o", "x" }, 'aK', ':<C-u>call TextObjWordBasedColumn("aW")<cr>', { noremap = true })
            vim.keymap.set({ "o", "x" }, 'ik', ':<C-u>call TextObjWordBasedColumn("iw")<cr>', { noremap = true })
            vim.keymap.set({ "o", "x" }, 'iK', ':<C-u>call TextObjWordBasedColumn("iW")<cr>', { noremap = true })
        end,
        extra_contexts = {"vscode", "firenvim"}
    },
    {
        "chrisgrieser/nvim-various-textobjs",
        keys = {
            {"ii" , "<cmd>lua require('various-textobjs').indentation('inner', 'inner')<CR>", { desc = "inner-inner indentation textobj", mode = { "o", "x" }}},
            {"ai" , "<cmd>lua require('various-textobjs').indentation('outer', 'inner')<CR>", { desc = "outer-inner indentation textobj", mode = { "o", "x" }}},
            {"iI" , "<cmd>lua require('various-textobjs').indentation('inner', 'inner')<CR>", { desc = "inner-inner indentation textobj", mode = { "o", "x" }}},
            {"aI" , "<cmd>lua require('various-textobjs').indentation('outer', 'outer')<CR>", { desc = "outer-outer indentation textobj", mode = { "o", "x" }}},
            { "R", '<cmd>lua require("various-textobjs").restOfIndentation()<CR>', mode = { "o", "x" } },
            { "ag", '<cmd>lua require("various-textobjs").greedyOuterIndentation("outer")<CR>', mode = { "o", "x" } },
            { "ig", '<cmd>lua require("various-textobjs").greedyOuterIndentation("inner")<CR>', mode = { "o", "x" } },
            { "iS", '<cmd>lua require("various-textobjs").subword("inner")<CR>', mode = { "o", "x" } },
            { "aS", '<cmd>lua require("various-textobjs").subword("outer")<CR>', mode = { "o", "x" } },
            { "C", '<cmd>lua require("various-textobjs").toNextClosingBracket()<CR>', mode = { "o", "x" } },
            { "Q", '<cmd>lua require("various-textobjs").toNextQuotationMark()<CR>', mode = { "o", "x" } },
            -- { "iq", '<cmd>lua require("various-textobjs").anyQuote("inner")<CR>', mode = { "o", "x" } },
            -- { "aq", '<cmd>lua require("various-textobjs").anyQuote("outer")<CR>', mode = { "o", "x" } },
            { "io", '<cmd>lua require("various-textobjs").anyBracket("inner")<CR>', mode = { "o", "x" } },
            { "ao", '<cmd>lua require("various-textobjs").anyBracket("outer")<CR>', mode = { "o", "x" } },
            { "r", '<cmd>lua require("various-textobjs").restOfParagraph()<CR>', mode = { "o", "x" } },
            { "gG", '<cmd>lua require("various-textobjs").entireBuffer()<CR>', mode = { "o", "x" } },
            -- { "n", '<cmd>lua require("various-textobjs").nearEoL()<CR>', mode = { "o", "x" } },
            { "i\\", '<cmd>lua require("various-textobjs").lineCharacterwise("inner")<CR>', mode = { "o", "x" } },
            { "a\\", '<cmd>lua require("various-textobjs").lineCharacterwise("outer")<CR>', mode = { "o", "x" } },
            { "|", '<cmd>lua require("various-textobjs").column("down")<CR>', mode = { "o", "x" }},
            { "a|", '<cmd>lua require("various-textobjs").column("both")<CR>', mode = { "o", "x" }},
            { "iv", '<cmd>lua require("various-textobjs").value("inner")<CR>', mode = { "o", "x" } },
            { "av", '<cmd>lua require("various-textobjs").value("outer")<CR>', mode = { "o", "x" } },
            { "ik", '<cmd>lua require("various-textobjs").key("inner")<CR>', mode = { "o", "x" } },
            { "ak", '<cmd>lua require("various-textobjs").key("outer")<CR>', mode = { "o", "x" } },
            { "L", '<cmd>lua require("various-textobjs").url()<CR>', mode = { "o", "x" } },
            -- { "in", '<cmd>lua require("various-textobjs").number("inner")<CR>', mode = { "o", "x" } },
            -- { "an", '<cmd>lua require("various-textobjs").number("outer")<CR>', mode = { "o", "x" } },
            { "!", '<cmd>lua require("various-textobjs").diagnostic()<CR>', mode = { "o", "x" } },
            { "iz", '<cmd>lua require("various-textobjs").closedFold("inner")<CR>', mode = { "o", "x" } },
            { "az", '<cmd>lua require("various-textobjs").closedFold("outer")<CR>', mode = { "o", "x" } },
            { "im", '<cmd>lua require("various-textobjs").chainMember("inner")<CR>', mode = { "o", "x" } },
            { "am", '<cmd>lua require("various-textobjs").chainMember("outer")<CR>', mode = { "o", "x" } },
            { "gw", '<cmd>lua require("various-textobjs").visibleInWindow()<CR>', mode = { "o", "x" } },
            { "gW", '<cmd>lua require("various-textobjs").restOfWindow()<CR>', mode = { "o", "x" } },
            { "g;", '<cmd>lua require("various-textobjs").lastChange()<CR>', mode = { "o", "x" } },
            { "iN", '<cmd>lua require("various-textobjs").notebookCell("inner")<CR>', mode = { "o", "x" } },
            { "aN", '<cmd>lua require("various-textobjs").notebookCell("outer")<CR>', mode = { "o", "x" } },
            { ".", '<cmd>lua require("various-textobjs").emoji()<CR>', mode = { "o", "x" } },
            -- { "i,", '<cmd>lua require("various-textobjs").argument("inner")<CR>', mode = { "o", "x" } },
            -- { "a,", '<cmd>lua require("various-textobjs").argument("outer")<CR>', mode = { "o", "x" } },
            -- { "iF", '<cmd>lua require("various-textobjs").filepath("inner")<CR>', mode = { "o", "x" } },
            -- { "aF", '<cmd>lua require("various-textobjs").filepath("outer")<CR>', mode = { "o", "x" } },
        },
        opts = {}
    },
}
