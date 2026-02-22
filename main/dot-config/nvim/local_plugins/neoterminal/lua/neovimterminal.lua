local vim_utils = require('vim_utils')

local TERMINAL_CMD = 'neovim-fish'

if vim.env.NVIM_SSH_MODE then
  TERMINAL_CMD = vim.fn.expand('$SHELL')
end

vim.keymap.set({"n", "t"}, "<c-space>h", '<c-\\><C-n><C-w><C-h>', { noremap = true, silent = true })
vim.keymap.set({"n", "t"}, "<c-space>j", '<c-\\><C-n><C-w><C-j>', { noremap = true, silent = true })
vim.keymap.set({"n", "t"}, "<c-space>k", '<c-\\><C-n><C-w><C-k>', { noremap = true, silent = true })
vim.keymap.set({"n", "t"}, "<c-space>l", '<c-\\><C-n><C-w><C-l>', { noremap = true, silent = true })
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
  vim.g.neovimterm_last_channel = nil
  if status == 0 then
    local winids = vim.fn.win_findbuf(bufnr)

    if #winids>0 then
      local winid = winids[1]
      local winnum = vim.fn.win_id2win(winid)

      vim.cmd(winnum.."quit")
    end

    if vim.opt.buftype:get() == "terminal" then
      vim_utils.feedkeys([[<c-\><c-n>i]])
    end
  end
end

local function start_terminal(opts)
  local split = opts.split
  local cmd = opts.cmd or TERMINAL_CMD
  local path = vim.fn["projectionist#path"]()

  if split == "vertical" then
    vim.cmd.vnew()
  elseif split == "horizontal" then
    vim.cmd.new()
  elseif split == "tab" then
    vim.cmd.tabnew()
  end

  local bufnr = vim.fn.bufnr('')

  vim.fn.jobstart(cmd, { on_exit = vim_utils.partial(close_on_exit, bufnr), term = true, cwd = path})
  vim_utils.feedkeys([[<c-\><c-n>i]])
end

vim.api.nvim_create_user_command("Neoterm", function (opts)
  start_terminal({cmd=opts.args})
end, {nargs='*'})

vim.keymap.set({'n', 't'}, '<c-space>v', function ()
  start_terminal({split="vertical"})
end, { noremap = true, silent = true })
vim.keymap.set({'n', 't'}, '<c-space>"', function ()
  start_terminal({split="horizontal"})
end, { noremap = true, silent = true })
vim.keymap.set({'n', 't'}, '<c-space>c',  function ()
  start_terminal({split="tab"})
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
  callback = function ()
    vim.cmd.startinsert()
    vim.g.neovimterm_last_channel = vim.o.channel
  end
})

vim.api.nvim_create_autocmd("BufLeave", {
  pattern = "term://*",
  group = au_group,
  callback = function ()
    vim.g.neovimterm_last_channel = vim.o.channel
    vim.cmd.stopinsert()
    -- Silently call tmux focus gained, we don't care if there's an error
    pcall(vim.fn["tmux_focus_events#focus_gained"])
  end
})

vim.api.nvim_create_autocmd("TermOpen", {
  pattern = "*",
  group = au_group,
  callback = function ()
    vim.keymap.set("n", "q", "i", { buffer = true })
    vim.opt_local.number = false
    vim.opt_local.relativenumber = false
    vim.opt_local.scrollback = 10000
    vim.cmd.startinsert()
  end
})

local function find_fallback_terminal()
  local terminals = {}
  local channel
  local windows = vim.api.nvim_tabpage_list_wins(0)
  for _, window in ipairs(windows) do
    local buf = vim.api.nvim_win_get_buf(window)
    local buftype = vim.api.nvim_buf_get_option(buf, "buftype")
    if buftype == "terminal" then
      terminals[#terminals + 1] = window
    end
  end

  if #terminals == 1 then
    local terminal = terminals[1]
    local term_buf = vim.api.nvim_win_get_buf(terminal)
    local term_channel = vim.api.nvim_buf_get_option(term_buf, "channel")
    channel = vim.api.nvim_get_chan_info(term_channel).id
  end

  return channel
end

function NvimTermWriteOperation(mode)
  vim.fn.setpos("'<", vim.fn.getpos("'["))
  vim.fn.setpos("'>", vim.fn.getpos("']"))

  local text = vim_utils.get_visual_selection(mode)

  local channel = vim.api.nvim_get_chan_info(vim.g.neovimterm_last_channel).id

  if not channel then
    channel = find_fallback_terminal()
    vim.g.neovimterm_last_channel = channel
  end

  if vim.g.neovimterm_last_channel and vim.api.nvim_get_chan_info(vim.g.neovimterm_last_channel).id then
    vim_utils.feedkeys([[<c-\><c-n>]])
    vim.api.nvim_chan_send(vim.g.neovimterm_last_channel, text .. "\n")
    vim_utils.temporary_highlight("'[", "']", {
      inclusive = true,
      mode = mode,
    })
    vim.fn.setcursorcharpos(unpack(vim.fn.getpos("'<"), 2))
  else
    vim.cmd.echoerr("No channel opened last. Navigate to a Term first!")
  end
end
