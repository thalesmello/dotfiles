return {
   "olimorris/codecompanion.nvim",
   opts = {
      strategies = {
         chat = {
            adapter = "gemini",
         },
         inline = {
            adapter = "gemini",
         },
         cmd = {
            adapter = "gemini",
         }
      },
      adapters = {
         gemini = function()
            return require("codecompanion.adapters").extend("gemini", {
               env = {
                  api_key = 'cmd:op read "op://Personal/thales-workflow Gemini API Key/credential" --no-newline',
               },
            })
         end,
      },
   },
   dependencies = {
      "nvim-lua/plenary.nvim",
      "nvim-treesitter/nvim-treesitter",
      "j-hui/fidget.nvim",
   },
   init = function ()
      require('config.code_companion_fidget_spinner'):init()
   end,
   config = function (_, opts)
      require("codecompanion").setup(opts)

      vim.keymap.set({ "n", "v" }, "<leader>ca", "<cmd>CodeCompanionActions<cr>", { noremap = true, silent = true })
      vim.keymap.set({ "n", "v" }, "<leader>cc", "<cmd>CodeCompanionChat Toggle<cr>", { noremap = true, silent = true })
      vim.keymap.set("v", "<leader>ga", "<cmd>CodeCompanionChat Add<cr>", { noremap = true, silent = true })

      vim.cmd.cabbrev("cc CodeCompanion")
   end
}
