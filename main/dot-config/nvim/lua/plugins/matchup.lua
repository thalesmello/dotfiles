local vim_utils = require('vim_utils')
return {
   vim_utils.injector_module({
      "andymass/vim-matchup",
      injectable_opts = {
         "nvim-treesitter/nvim-treesitter",
         opts = {
            matchup = {
               enable = true,
               disable = {},
            }
         }
      },
      extra_contexts = {"firenvim"},
      cond = true,
   }),
}
