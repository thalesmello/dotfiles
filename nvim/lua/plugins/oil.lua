return {
   {
      "stevearc/oil.nvim",
      opts = {},
      dependencies = { "nvim-tree/nvim-web-devicons" },
      keys = {
         {"-", "<CMD>Oil<CR>", mode = "n", desc = "Open parent directory" }
      },
      lazy = false,
   }
}
