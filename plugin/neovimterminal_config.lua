local s_terminal = 'term://neovim-fish'

vim.keymap.set({"n", "v", "o"}, "<c-space><c-h>", '<C-w><C-h>', { noremap = true, silent = true })
vim.keymap.set({"n", "v", "o"}, "<c-space><c-j>", '<C-w><C-j>', { noremap = true, silent = true })
vim.keymap.set({"n", "v", "o"}, "<c-space><c-k>", '<C-w><C-k>', { noremap = true, silent = true })
vim.keymap.set({"n", "v", "o"}, "<c-space><c-l>", '<C-w><C-l>', { noremap = true, silent = true })

vim.keymap.set("t", "<c-space><c-h>", '<c-\\><C-n><C-w><C-h>', { noremap = true, silent = true })
vim.keymap.set("t", "<c-space><c-j>", '<c-\\><C-n><C-w><C-j>', { noremap = true, silent = true })
vim.keymap.set("t", "<c-space><c-k>", '<c-\\><C-n><C-w><C-k>', { noremap = true, silent = true })
vim.keymap.set("t", "<c-space><c-l>", '<c-\\><C-n><C-w><C-l>', { noremap = true, silent = true })

vim.keymap.set("t", "<c-space>:", '<c-\\><C-n>:', { noremap = true })
vim.keymap.set("t", "<c-space><space>", '<c-\\><C-n>', { noremap = true, silent = true })
vim.keymap.set("t", "<c-space><bs>", '<c-\\><C-n><c-w>q', { noremap = true, silent = true })
vim.keymap.set("n", "<c-space><bs>", '<c-w>q', { noremap = true, silent = true })


vim.keymap.set("t", "<c-space><c-n>", '<c-\\><C-n><c-w>gt', { noremap = true, silent = true })
vim.keymap.set("n", "<c-space><c-n>", 'gt', { noremap = true, silent = true })
vim.keymap.set("t", "<c-space><c-p>", '<c-\\><C-n><c-w>gT', { noremap = true, silent = true })
vim.keymap.set("n", "<c-space><c-p>", 'gT', { noremap = true, silent = true })

vim.keymap.set("t", "<c-space>J", '<c-\\><C-n><leader>J', { remap = true, silent = true })
vim.keymap.set("t", "<c-space>H", '<c-\\><C-n><leader>H', { remap = true, silent = true })
vim.keymap.set("t", "<c-space>K", '<c-\\><C-n><leader>K', { remap = true, silent = true })
vim.keymap.set("t", "<c-space>L", '<c-\\><C-n><leader>L', { remap = true, silent = true })
vim.keymap.set("n", "<c-space>J", '<leader>J', { remap = true, silent = true })
vim.keymap.set("n", "<c-space>H", '<leader>H', { remap = true, silent = true })
vim.keymap.set("n", "<c-space>K", '<leader>K', { remap = true, silent = true })
vim.keymap.set("n", "<c-space>L", '<leader>L', { remap = true, silent = true })


vim.keymap.set("n", "<c-space>=", '<c-w>=', { noremap = true })
vim.keymap.set("n", "<c-space>+", '<c-w>|<c-w>_', { noremap = true })
vim.keymap.set("n", "<c-space>|", '<c-w>|', { noremap = true })
vim.keymap.set("t", "<c-space>=", '<c-\\><c-n><c-w>=', { noremap = true })
vim.keymap.set("t", "<c-space>+", '<c-\\><c-n><c-w>|<c-w>_', { noremap = true })
vim.keymap.set("t", "<c-space>|", '<c-\\><c-n><c-w>|', { noremap = true })

vim.keymap.set("t", "<c-space>1", '<c-\\><c-n>1gt', { noremap = true })
vim.keymap.set("t", "<c-space>2", '<c-\\><c-n>2gt', { noremap = true })
vim.keymap.set("t", "<c-space>3", '<c-\\><c-n>3gt', { noremap = true })
vim.keymap.set("t", "<c-space>4", '<c-\\><c-n>4gt', { noremap = true })
vim.keymap.set("t", "<c-space>5", '<c-\\><c-n>5gt', { noremap = true })
vim.keymap.set("t", "<c-space>6", '<c-\\><c-n>6gt', { noremap = true })
vim.keymap.set("t", "<c-space>7", '<c-\\><c-n>7gt', { noremap = true })
vim.keymap.set("t", "<c-space>8", '<c-\\><c-n>8gt', { noremap = true })
vim.keymap.set("t", "<c-space>9", '<c-\\><c-n>9gt', { noremap = true })

vim.keymap.set('t', '<c-space>v', '<c-\\><c-n><cmd>vsplit ' .. s_terminal .. '<CR>', { noremap = true, silent = true })
vim.keymap.set('t', '<c-space>"', '<c-\\><c-n><cmd>split ' .. s_terminal .. '<CR>', { noremap = true, silent = true })
vim.keymap.set('t', '<c-space>c', '<c-\\><c-n><cmd>tabnew ' .. s_terminal .. '<CR>', { noremap = true, silent = true })
vim.keymap.set('n', '<c-space>v', '<cmd>vsplit ' .. s_terminal .. '<CR>', { noremap = true, silent = true })
vim.keymap.set('n', '<c-space>"', '<cmd>split ' .. s_terminal .. '<CR>', { noremap = true, silent = true })
vim.keymap.set('n', '<c-space>c', '<cmd>tabnew ' .. s_terminal .. '<CR>', { noremap = true, silent = true })

vim.keymap.set("t", "<4-ScrollWheelUp>", '<nop>', { noremap = true })
vim.keymap.set("t", "<3-ScrollWheelUp>", '<nop>', { noremap = true })
vim.keymap.set("t", "<2-ScrollWheelUp>", '<nop>', { noremap = true })
vim.keymap.set("t", "<4-ScrollWheelDown>", '<nop>', { noremap = true })
vim.keymap.set("t", "<3-ScrollWheelDown>", '<nop>', { noremap = true })
vim.keymap.set("t", "<2-ScrollWheelDown>", '<nop>', { noremap = true })


local au_group = vim.api.nvim_create_augroup("NeovimTerminalGroup", { clear = true })

vim.api.nvim_create_autocmd({ "BufWinEnter", "WinEnter", "BufEnter" }, {
  pattern = "term://*",
  group = au_group,
  command = "startinsert",
})

vim.api.nvim_create_autocmd("BufLeave", {
  pattern = "term://*",
  group = au_group,
  callback = function ()
    vim.cmd.stopinsert()
    vim.fn["tmux_focus_events#focus_gained"]()
  end
})

vim.api.nvim_create_autocmd("TermOpen", {
  pattern = "*",
  group = au_group,
  callback = function ()
    vim.keymap.set("n", "q", "i", { buffer = true })
    vim.opt_local.number = false
    vim.opt_local.relativenumber = false
  end
})

vim.api.nvim_create_autocmd("TermClose", {
  pattern = "*",
  group = au_group,
  callback = function ()
    if vim.v.event.status == 0 then
      vim.cmd.bdelete({ args = { vim.fn.expand("<abuf>") }, bang = true})
    end
  end
})
