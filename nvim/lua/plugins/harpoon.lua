return {
   "ThePrimeagen/harpoon",
   branch = "harpoon2",
   dependencies = { "nvim-lua/plenary.nvim" },
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
   extra_contexts = {"vscode"}
}
