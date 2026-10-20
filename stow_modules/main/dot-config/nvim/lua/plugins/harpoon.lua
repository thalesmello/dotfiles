return {
   {
      "nvim-lua/plenary.nvim" ,
      lazy = true,
      extra_contexts = {"ssh"},
      opts = {},
      config = function() end
   },
   {
      "ThePrimeagen/harpoon",
      branch = "harpoon2",
      dependencies = { "nvim-lua/plenary.nvim" },
      keys = {
         { "<leader>ka", desc = "Harpoon add" },
         { "<leader>ke", desc = "Harpoon quick menu" },
         { "<leader>1", desc = "Harpoon 1" },
         { "<leader>2", desc = "Harpoon 2" },
         { "<leader>3", desc = "Harpoon 3" },
         { "<leader>4", desc = "Harpoon 4" },
         { "<leader>5", desc = "Harpoon 5" },
         { "<leader>6", desc = "Harpoon 6" },
         { "<leader>7", desc = "Harpoon 7" },
         { "<leader>8", desc = "Harpoon 8" },
         { "<leader>9", desc = "Harpoon 9" },
         { "[h", desc = "Harpoon prev" },
         { "]h", desc = "Harpoon next" },
      },
      opts = {

      },
      config = function (_, opts)
         local harpoon = require("harpoon")

         harpoon.setup(opts)

         vim.keymap.set("n", "<leader>ka", function() harpoon:list():add() end)
         vim.keymap.set("n", "<leader>ke", function() harpoon.ui:toggle_quick_menu(harpoon:list()) end)

         vim.keymap.set("n", "<leader>1", function() harpoon:list():select(1) end)
         vim.keymap.set("n", "<leader>2", function() harpoon:list():select(2) end)
         vim.keymap.set("n", "<leader>3", function() harpoon:list():select(3) end)
         vim.keymap.set("n", "<leader>4", function() harpoon:list():select(4) end)
         vim.keymap.set("n", "<leader>5", function() harpoon:list():select(5) end)
         vim.keymap.set("n", "<leader>6", function() harpoon:list():select(6) end)
         vim.keymap.set("n", "<leader>7", function() harpoon:list():select(7) end)
         vim.keymap.set("n", "<leader>8", function() harpoon:list():select(8) end)
         vim.keymap.set("n", "<leader>9", function() harpoon:list():select(9) end)

         -- Toggle previous & next buffers stored within Harpoon list
         vim.keymap.set("n", "[h", function() harpoon:list():prev() end)
         vim.keymap.set("n", "]h", function() harpoon:list():next() end)
      end,
      extra_contexts = {"vscode", "ssh"}
   }}
