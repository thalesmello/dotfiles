vim.g.projectionist_heuristics = vim.tbl_deep_extend(
    'force',
    vim.g.projectionist_heuristics or {},
    {
        ["src/dotfiles/"] = {
            ["src/dotfiles/main/dot-skhdrc_main"] = {
                alternate= { "src/dotfiles/local/dot-skhdrc_local", "src/dotfiles/main/dot-skhdrc" },
                type= "skhd_main",
            },
            ["src/dotfiles/local/dot-skhdrc_local"] = {
                alternate = { "src/dotfiles/main/dot-skhdrc", "src/dotfiles/main/dot-skhdrc_main" },
                type = "skhd_local",
            },
            ["src/dotfiles/main/dot-skhdrc"] = {
                alternate = { "src/dotfiles/main/dot-skhdrc_main", "src/dotfiles/local/dot-skhdrc_local" },
                type = "skhd",
            },
            ["src/dotfiles/main/sketchybarrc"] = {
                alternate="src/dotfiles/local/dot-sketchybarrc_local",
                type= "sketchybarrc",
                dispatch= "sketchybar --reload",
            },
            ["src/dotfiles/local/dot-sketchybarrc_local"] = {
                alternate = "src/dotfiles/main/sketchybarrc",
                type = "sketchybarrc_local",
                dispatch= "sketchybar --reload",
            },
        },
    })
