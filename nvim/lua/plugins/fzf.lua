return {
    "ibhagwan/fzf-lua",
    dependencies = { 'junegunn/fzf', 'vim-projectionist', "nvim-tree/nvim-web-devicons" },
    keys = {
        {"<c-p>", mode = "n"},
        {"<c-p>", mode = "v"},
        {"<c-f>", mode = "n"},
        {"<leader>/", mode = "n"},
        {"<leader>/", mode = "v"},
        {"<leader>?", mode = "v"},
    },
    cmd = {
        "Files", "GFiles", "GFiles", "Buffers", "Colors", "Ag", "Rg",
        "RG", "Lines", "BLines", "Tags", "BTags", "Changes", "Marks", "Jumps",
        "Windows", "Locate", "History", "", "History", "Snippets", "Commits",
        "BCommits", "Commands", "Maps", "Helptags", "Filetypes"
    },
    config = function()
        vim.cmd([[
            augroup fzf-custom
                autocmd!
                if has('nvim')
                    hi NormalFloat ctermfg=LightGrey
                endif
            augroup END
        ]])
        require("fzf-lua").setup({ "fzf-vim" })
        require('config/fzf')
    end,
}
