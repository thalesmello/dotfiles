return {
    'junegunn/fzf.vim',
    dependencies = { 'junegunn/fzf', 'vim-projectionist' },
    keys = {
        {"<c-p>", mode = "n"},
        {"<c-p>", mode = "v"},
        {"<c-f>", mode = "n"},
        {"<leader>/", mode = "n"},
        {"<leader>/", mode = "v"},
        {"<leader>?", mode = "v"},
        {"<leader>ft", mode = "n"},
    },
    cmd = {
        "Files", "GFiles", "GFiles", "Buffers", "Colors", "Ag", "Rg",
        "RG", "Lines", "BLines", "Tags", "BTags", "Changes", "Marks", "Jumps",
        "Windows", "Locate", "History", "", "History", "Snippets", "Commits",
        "BCommits", "Commands", "Maps", "Helptags", "Filetypes"
    },
    config = function()
        require('config/fzf')
    end,
}
