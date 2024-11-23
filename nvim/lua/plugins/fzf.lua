return {
    'junegunn/fzf.vim',
    -- "ibhagwan/fzf-lua",
    dependencies = { 'junegunn/fzf', 'vim-projectionist' },
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
        -- require("fzf-lua").setup({ "fzf-vim" })
        require('config/fzf')
    end,
}
