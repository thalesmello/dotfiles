-- ~/.config/nvim/lua/plugins/org.lua
return {
  "xheisenbugx/org.nvim",
  main = "org",
  lazy = false, -- startup cost is small: heavy modules load on first use
  opts = function()
    return dofile(vim.fn.stdpath("config") .. "/org-cli.lua")
  end,
}
