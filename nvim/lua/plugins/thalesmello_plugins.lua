return {
    { 'thalesmello/gitignore', event = "VeryLazy" },
    { 'thalesmello/lkml.vim', ft = 'lkml' },
    { 'thalesmello/tabmessage.vim', cmd = "TabMessage" },
    {
        'thalesmello/persistent.vim',
        event = { "BufReadPost", "BufNewFile", "BufFilePost" },
    },
    -- { 'thalesmello/webcomplete.vim', cond = vim.fn.has('macunix' ) },
}
