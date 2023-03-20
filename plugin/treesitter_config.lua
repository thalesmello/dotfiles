require'nvim-treesitter.configs'.setup {
   ensure_installed = {"lua", "vim", "python", "sql", "ruby" },


   highlight = {
      enable = true,
      additional_vim_regex_highlighting = false,
   },

   incremental_selection = {
      enable = true,
      keymaps = {
         init_selection = "ghh", -- set to `false` to disable one of the mappings
         node_incremental = "gh]",
         scope_incremental = "gh}",
         node_decremental = "gh[",
      },
   },

   indent = {
      enable = true
   },
}

vim.opt.foldmethod = "expr"
vim.opt.foldexpr = "nvim_treesitter#foldexpr()"
