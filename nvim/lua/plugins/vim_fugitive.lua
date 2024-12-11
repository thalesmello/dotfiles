return {
    'tpope/vim-fugitive',
    dependencies = {
        { 'shumphrey/fugitive-gitlab.vim' },
        { 'tpope/vim-rhubarb' },
    },
    keys = {
        {"<leader>gd", "<cmd>Gdiffsplit<cr>",  noremap = true },
        {"<leader>gs", "<cmd>Git<cr>",  noremap = true },
        {"<leader>gw", "<cmd>Git write<cr>",  noremap = true },
        {"<leader>ga", "<cmd>Git add<cr>",  noremap = true },
        {"<leader>gb", "<cmd>Git blame<cr>",  noremap = true },
        {"<leader>gci", "<cmd>Git commit<cr>",  noremap = true },
        {"<leader>gm", "<cmd>Git move",  noremap = true },
        {"<leader>gr", "<cmd>Git read<cr>",  noremap = true },
        {"<leader>grm", "<cmd>Git remove<cr>",  noremap = true },
    },
    cmd = {"Git", "G", "Gdiffsplit", "GMove", "GBrowse"},
    config = function()
        vim.g.fugitive_gitlab_domains = { 'http://gitlab.platform' }
    end,
    lazy = false,
}
