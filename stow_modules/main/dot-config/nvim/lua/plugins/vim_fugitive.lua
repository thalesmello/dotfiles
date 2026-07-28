return {
    'tpope/vim-fugitive',
    dependencies = {
        { 'shumphrey/fugitive-gitlab.vim' },
        { 'tpope/vim-rhubarb' },
    },
    keys = {
        {"<leader>gd", "<cmd>Gdiffsplit<cr>",  noremap = true },
        {"<leader>gs", "<cmd>Git<cr>",  noremap = true },
        {"<leader>gb", "<cmd>Git blame<cr>",  noremap = true },
    },
    cmd = {"Git", "G", "Gdiffsplit", "GMove", "GBrowse"},
    config = function()
        vim.g.fugitive_gitlab_domains = { 'http://gitlab.platform' }
    end,
    lazy = false,
}
