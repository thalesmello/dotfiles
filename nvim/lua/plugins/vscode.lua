if not vim.g.vscode then
  return {}
end

vim.g.debug_vscode = vim.empty_dict()


require("lazy.core.config").options.defaults.cond = function(plugin)
  return (
    plugin.vscode
    or plugin._.dep
    or plugin.name == 'lazy.nvim'
  )

end

-- vim.keymap.set("n", "<leader><space>", "<cmd>Find<cr>")
vim.keymap.set("n", "<leader>/", [[<cmd>lua require('vscode').action('workbench.action.findInFiles')<cr>]])
vim.keymap.set("n", "<leader>ss", [[<cmd>lua require('vscode').action('workbench.action.gotoSymbol')<cr>]])
vim.keymap.set("n", "<leader><space>", [[<cmd>lua require('vscode').action('workbench.action.terminal.toggleTerminal')<cr>]])

return {}
