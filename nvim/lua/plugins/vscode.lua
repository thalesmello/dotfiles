if not vim.g.vscode then
  return {}
end

local vscode = require('vscode')

-- This is makes extensions not be enabled by default
-- To enable, add "vscode = true" to the plugin spec
require("lazy.core.config").options.defaults.cond = require('conditional_load').should_load

local function inferMoveKey(direction)
  return function ()
    if vim.v.count > 0 or vim.fn.reg_recording() ~= '' then
      return direction
    else
      return "g" .. direction
    end
   end
end


vim.keymap.set("n", "j", inferMoveKey("j"), { remap = true, expr = true })

vim.keymap.set("n", "k", inferMoveKey("k"), { remap = true, expr = true })

vim.keymap.set("n", "<leader><c-r>", function () vscode.action('vscode-neovim.restart') end)

vim.keymap.set("n", "gr", function () vscode.action('editor.action.rename') end)

vim.keymap.set("n", "<c-t>", function () vscode.action('workbench.action.navigateBackInEditLocations') end)
vim.keymap.set("n", "<c-f>", function () vscode.action('workbench.action.findInFiles') end)
vim.keymap.set("n", "<leader>/", "viw<cmd>lua require('vscode').action('workbench.action.findInFiles')<cr>")

vim.keymap.set("v", "<leader>/", function ()
  vscode.action('workbench.action.findInFiles')
end)

vim.keymap.set("n", "gR", function () vscode.action('references-view.findReferences') end)
vim.keymap.set("n", "<leader>ss", function () vscode.action('workbench.action.gotoSymbol') end)
vim.keymap.set("n", "<leader><cr>", function () vscode.action('workbench.action.terminal.toggleTerminal') end)
vim.keymap.set("n", "<tab>", function () vscode.action('editor.toggleFold') end)
vim.keymap.set("n", "zC", function () vscode.action('editor.foldRecursively') end)
vim.keymap.set("n", "zO", function () vscode.action('editor.unfoldRecursively') end)
vim.keymap.set("n", "zR", function () vscode.action('editor.unfoldAll') end)
vim.keymap.set("n", "zM", function () vscode.action('editor.foldAll') end)

-- Simulate my most used vim-unimpaired shortcut
vim.keymap.set("n", "[<space>", "<cmd>put!=repeat(nr2char(10), v:count1)|silent ']+<cr>")
vim.keymap.set("n", "]<space>", "<cmd>put =repeat(nr2char(10), v:count1)|silent '[-<cr>")
vim.keymap.set("n", "[g", function () vscode.action('editor.action.marker.prev') end)
vim.keymap.set("n", "]g", function () vscode.action('editor.action.marker.next') end)
vim.keymap.set("n", "[l", function () vscode.action('editor.action.marker.prev') end)
vim.keymap.set("n", "]l", function () vscode.action('editor.action.marker.next') end)
vim.keymap.set("n", "[q", function () vscode.action('action.marker.prevInFiles') end)
vim.keymap.set("n", "]q", function () vscode.action('action.marker.nextInFiles') end)


vim.keymap.set("n", "<leader>.", function () vscode.action('editor.action.quickFix') end)

vim.api.nvim_create_autocmd({ 'BufEnter' }, {
  group = vim.api.nvim_create_augroup('VsCodeAugroup', { clear = true }),
  pattern = {"*"},
  callback = function()
    vim.o.relativenumber = true
  end,
})

return {}
