vim.g.projectionist_heuristics = vim.tbl_deep_extend(
    'force',
    vim.g.projectionist_heuristics or {},
    {
        ["src/dotfiles/"] = {
            ["src/dotfiles/stow_modules/main/nvim/init.lua"] = {
                alternate="src/dotfiles/local/dot-local_dotfiles/nvim/init.lua",
                type= "nviminit",
            },
            ["src/dotfiles/local/dot-local_dotfiles/nvim/init.lua"] = {
                alternate = "src/dotfiles/stow_modules/main/nvim/init.lua",
                type = "localnvim",
            },
        },
    })
