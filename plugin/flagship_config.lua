vim.api.nvim_create_autocmd("User", {
   pattern = "Flags",
   group = vim.api.nvim_create_augroup("FlagshipConfig", { clear = true }),
   callback = function ()
      vim.fn.Hoist("buffer", -1, "WebDevIconsGetFileTypeSymbol")
      vim.fn.Hoist("buffer", "StatuslineFugitiveBranch")
      vim.fn.Hoist("window", "CocStatus")
      vim.fn.Hoist("window", "CocCurrentFunction")
   end
})

vim.g.tabprefix = ""

vim.g.flagship_skip = [[FugitiveStatusline\|flagship#filename]]
