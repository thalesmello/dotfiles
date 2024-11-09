return {
    {
        'kana/vim-textobj-user',
        dependencies = {
            { 'michaeljsmith/vim-indent-object' },
            { 'thalesmello/vim-textobj-methodcall' },
            { 'glts/vim-textobj-comment' },
            { 'Julian/vim-textobj-variable-segment' },
            { 'kana/vim-textobj-entire' },
            { 'thalesmello/vim-textobj-bracketchunk' },
            -- Only works vim treesitter syntax, doesn't work with Tree sitter yet
            -- { 'thalesmello/vim-textobj-multiline-str' },
        },
        vscode = true,
        firenvim = true,
    },
    { "PeterRincker/vim-argumentative" },
}
