return {
   {
      "mfussenegger/nvim-lint",
      lazy = true,
      config = function()
         require('lint').linters_by_ft = {
            python = { 'flake8' }
         }

         local group = vim.api.nvim_create_augroup("LintGroup", { clear = true })

         vim.api.nvim_create_autocmd({ "BufEnter", "BufWritePost" }, {
            group = group,
            callback = function() require("lint").try_lint() end,
         })
      end

   },
   {
      "rshkarin/mason-nvim-lint",
      lazy = true,
      dependencies = {
         "mfussenegger/nvim-lint",
         'williamboman/mason.nvim'
      },
      opts = {}
   }
}
