return {
   {
      dir = vim.fn.stdpath("config") .. "/local_plugins/nvim_restart/",
      dev = true,
      keys = {
         -- { "<leader>rv", function () require('nvim_restart').exit_status_one() end }
      },
   },
}
