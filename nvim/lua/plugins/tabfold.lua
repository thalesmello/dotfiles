return {
    'thalesmello/tabfold',
    keys = {"<tab>", "<s-tab>"},
    init = function()
        vim.g.tabfold_enforce_forward_or_toggle_fold = 1
    end
}
