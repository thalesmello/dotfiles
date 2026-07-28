return {
    {
        'farmergreg/vim-lastplace',
        event = { "BufReadPost", "BufNewFile", "BufFilePost" },
        extra_contexts = {"ssh"},
    }
}
