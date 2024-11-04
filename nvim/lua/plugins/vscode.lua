if not vim.g.vscode then
  return {}
end

local vscode = require('vscode')

-- This is makes extensions not be enabled by default
-- To enable, add "vscode = true" to the plugin spec
require("lazy.core.config").options.defaults.cond = function(plugin)
  return (
    plugin.vscode
    or plugin._.dep
    or plugin.name == 'lazy.nvim'
  )

end

-- vim.keymap.set("n", "<leader><space>", "<cmd>Find<cr>")
vim.keymap.set("n", "<leader>/", function () vscode.action('workbench.action.findInFiles') end)
vim.keymap.set("n", "<leader>ss", function () vscode.action('workbench.action.gotoSymbol') end)
vim.keymap.set("n", "<leader><cr>", function () vscode.action('workbench.action.terminal.toggleTerminal') end)
vim.keymap.set("n", "<tab>", function () vscode.action('editor.toggleFold') end)
vim.keymap.set("n", "zC", function () vscode.action('editor.foldRecursively') end)
vim.keymap.set("n", "zO", function () vscode.action('editor.unfoldRecursively') end)
vim.keymap.set("n", "zR", function () vscode.action('editor.unfoldAll') end)
vim.keymap.set("n", "zM", function () vscode.action('editor.foldAll') end)

-- Simulate my most used vim-unimpaired shortcut
vim.keymap.set("n", "[<space>", "O<esc>")
vim.keymap.set("n", "]<space>", "o<esc>")

vim.o.relativenumber = true

return {}
