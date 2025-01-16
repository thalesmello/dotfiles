return {
   {
      dir = vim.fn.stdpath("config") .. "/local_plugins/fish-bang/",
      dev = true,
      config = function ()
         require('fish_bang').setup()

         vim.keymap.set("x", "!", ":Fish<space>", { remap = false })
         vim.keymap.set("n", "!", "<Plug>FishBangFilterOperator", {})
         vim.keymap.set("n", "!!", "<Plug>FishBangFilterOperator_", {})
      end
   }
}
