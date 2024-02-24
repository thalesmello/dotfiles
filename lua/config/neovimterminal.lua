local vim_utils = require('vim_utils')

local terminal_cmd = 'neovim-fish'

vim.keymap.set({"n", "t"}, "<c-space><c-h>", '<c-\\><C-n><C-w><C-h>', { noremap = true, silent = true })
vim.keymap.set({"n", "t"}, "<c-space><c-j>", '<c-\\><C-n><C-w><C-j>', { noremap = true, silent = true })
vim.keymap.set({"n", "t"}, "<c-space><c-k>", '<c-\\><C-n><C-w><C-k>', { noremap = true, silent = true })
vim.keymap.set({"n", "t"}, "<c-space><c-l>", '<c-\\><C-n><C-w><C-l>', { noremap = true, silent = true })

vim.keymap.set({"n", "t"}, "<c-space>:", '<c-\\><C-n>:', { noremap = true })
vim.keymap.set("t", "<c-space><space>", '<c-\\><C-n>', { noremap = true, silent = true })
vim.keymap.set({"n", "t"}, "<c-space><bs>", '<c-\\><C-n><c-w>q', { noremap = true, silent = true })


vim.keymap.set("t", "<c-space><c-n>", '<c-\\><C-n><c-w>gt', { noremap = true, silent = true })
vim.keymap.set("n", "<c-space><c-n>", 'gt', { noremap = true, silent = true })
vim.keymap.set("t", "<c-space><c-p>", '<c-\\><C-n><c-w>gT', { noremap = true, silent = true })
vim.keymap.set("n", "<c-space><c-p>", 'gT', { noremap = true, silent = true })

vim.keymap.set({"n", "t"}, "<c-space>J", '<c-\\><C-n><leader>J', { remap = true, silent = true })
vim.keymap.set({"n", "t"}, "<c-space>H", '<c-\\><C-n><leader>H', { remap = true, silent = true })
vim.keymap.set({"n", "t"}, "<c-space>K", '<c-\\><C-n><leader>K', { remap = true, silent = true })
vim.keymap.set({"n", "t"}, "<c-space>L", '<c-\\><C-n><leader>L', { remap = true, silent = true })

vim.keymap.set({"n", "t"}, "<c-space>=", '<c-\\><c-n><c-w>=', { noremap = true })
vim.keymap.set({"n", "t"}, "<c-space>+", '<c-\\><c-n><c-w>|<c-w>_', { noremap = true })
vim.keymap.set({"n", "t"}, "<c-space>|", '<c-\\><c-n><c-w>|', { noremap = true })

vim.keymap.set({"n", "t"}, "<c-space>1", '<c-\\><c-n>1gt', { noremap = true })
vim.keymap.set({"n", "t"}, "<c-space>2", '<c-\\><c-n>2gt', { noremap = true })
vim.keymap.set({"n", "t"}, "<c-space>3", '<c-\\><c-n>3gt', { noremap = true })
vim.keymap.set({"n", "t"}, "<c-space>4", '<c-\\><c-n>4gt', { noremap = true })
vim.keymap.set({"n", "t"}, "<c-space>5", '<c-\\><c-n>5gt', { noremap = true })
vim.keymap.set({"n", "t"}, "<c-space>6", '<c-\\><c-n>6gt', { noremap = true })
vim.keymap.set({"n", "t"}, "<c-space>7", '<c-\\><c-n>7gt', { noremap = true })
vim.keymap.set({"n", "t"}, "<c-space>8", '<c-\\><c-n>8gt', { noremap = true })
vim.keymap.set({"n", "t"}, "<c-space>9", '<c-\\><c-n>9gt', { noremap = true })

local function close_on_exit(bufnr, _, status)
  if status == 0 then
    vim.cmd.bdelete({ args = {bufnr}, bang = true})

    if vim.opt.buftype:get() == "terminal" then
      vim_utils.feedkeys([[<c-\><c-n>i]])
    end
  end
end

local function start_terminal()
  local bufnr = vim.fn.bufnr('')
  vim.fn.termopen(terminal_cmd, { on_exit = vim_utils.partial(close_on_exit, bufnr) })
  vim_utils.feedkeys([[<c-\><c-n>i]])
end

vim.keymap.set({'n', 't'}, '<c-space>v', function ()
  vim.cmd.vnew()
  start_terminal()
end, { noremap = true, silent = true })
vim.keymap.set({'n', 't'}, '<c-space>"', function ()
  vim.cmd.new()
  start_terminal()
end, { noremap = true, silent = true })
vim.keymap.set({'n', 't'}, '<c-space>c',  function ()
  vim.cmd.tabnew()
  start_terminal()
end, { noremap = true, silent = true })

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
  callaback = function ()
    vim.cmd.startinsert()
    vim.g.neovimterm_last_channel = vim.o.channel
  end
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
