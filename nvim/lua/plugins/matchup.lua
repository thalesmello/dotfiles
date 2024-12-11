return {
   {
      "andymass/vim-matchup",
      firenvim = true,
   },
   {
      "nvim-treesitter/nvim-treesitter",
      opts = function(_, opts)
         return vim.tbl_deep_extend('force', opts or {}, {
            matchup = {
               enable = true,
               disable = {},
            }
         })
      end,
      dependencies = {
         'andymass/vim-matchup',
      },
      optional = true,
      firenvim = true,
   },
}
