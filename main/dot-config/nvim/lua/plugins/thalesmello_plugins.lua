return {
    { 'thalesmello/gitignore', event = "VeryLazy" },
    { 'thalesmello/lkml.vim', ft = 'lkml' },
    {
        'thalesmello/tabmessage.vim',
        cmd = "TabMessage",
        extra_contexts = {"firenvim", "lite_mode"}
    },
    {
        'thalesmello/persistent.vim',
        event = { "BufReadPost", "BufNewFile", "BufFilePost" },
    },
    {
        'thalesmello/tabfold',
        keys = {"<tab>", "<s-tab>"},
        init = function()
            vim.g.tabfold_enforce_forward_or_toggle_fold = 1
        end,
        extra_contexts = {"firenvim", "lite_mode"},
    }
    -- { 'thalesmello/webcomplete.vim', cond = vim.fn.has('macunix' ) },
}
