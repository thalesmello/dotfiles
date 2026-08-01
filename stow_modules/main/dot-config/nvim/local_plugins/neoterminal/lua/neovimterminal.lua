local vim_utils = require('vim_utils')

local TERMINAL_CMD = 'neovim-fish'

if vim.env.NVIM_SSH_MODE then
  TERMINAL_CMD = vim.fn.expand('$SHELL')
end

vim.keymap.set({"n", "t"}, "<c-space>h", '<c-\\><C-n><C-w><C-h>', { noremap = true, silent = true })
vim.keymap.set({"n", "t"}, "<c-space>j", '<c-\\><C-n><C-w><C-j>', { noremap = true, silent = true })
vim.keymap.set({"n", "t"}, "<c-space>k", '<c-\\><C-n><C-w><C-k>', { noremap = true, silent = true })
vim.keymap.set({"n", "t"}, "<c-space>l", '<c-\\><C-n><C-w><C-l>', { noremap = true, silent = true })
vim.keymap.set({"n", "t", "i", "v"}, "<c-space><c-h>", '<c-\\><C-n><C-w><C-h>', { noremap = true, silent = true })
vim.keymap.set({"n", "t", "i", "v"}, "<c-space><c-j>", '<c-\\><C-n><C-w><C-j>', { noremap = true, silent = true })
vim.keymap.set({"n", "t", "i", "v"}, "<c-space><c-k>", '<c-\\><C-n><C-w><C-k>', { noremap = true, silent = true })
vim.keymap.set({"n", "t", "i", "v"}, "<c-space><c-l>", '<c-\\><C-n><C-w><C-l>', { noremap = true, silent = true })

vim.keymap.set({"n", "t"}, "<c-space>:", '<c-\\><C-n>:', { noremap = true })
vim.keymap.set("t", "<c-space><space>", '<c-\\><C-n>', { noremap = true, silent = true })
vim.keymap.set({"n", "t"}, "<c-space><bs>", '<c-\\><C-n><c-w>q', { noremap = true, silent = true })


vim.keymap.set({"t", "n", "v", "i"}, "<c-space><c-n>", '<c-\\><C-n><c-w>gt', { noremap = true, silent = true })
vim.keymap.set({"t", "n", "v", "i"}, "<c-space><c-p>", '<c-\\><C-n><c-w>gT', { noremap = true, silent = true })
vim.keymap.set({"t", "n", "v", "i"}, "<c-space><c-]>", '<c-\\><C-n><c-w>gt', { noremap = true, silent = true })
vim.keymap.set({"t", "n", "v", "i"}, "<c-space><c-[>", '<c-\\><C-n><c-w>gT', { noremap = true, silent = true })

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

local function find_dcs_end(data, from)
  local scan = from
  while scan < #data do
    if data:byte(scan) == 0x1B and data:byte(scan + 1) == 0x5C then
      local esc_count = 0
      local p = scan - 1
      while p >= from and data:byte(p) == 0x1B do
        esc_count = esc_count + 1
        p = p - 1
      end
      if esc_count % 2 == 0 then
        return scan + 1
      end
    end
    scan = scan + 1
  end
  return nil
end

local function create_dcs_filter()
  local pending = ''

  return function(data)
    pending = pending .. data
    local output = {}
    local pos = 1

    while pos <= #pending do
      local dcs_start = pending:find('\027P', pos, true)
      if not dcs_start then
        output[#output + 1] = pending:sub(pos)
        break
      end

      if dcs_start > pos then
        output[#output + 1] = pending:sub(pos, dcs_start - 1)
      end

      local dcs_end = find_dcs_end(pending, dcs_start + 2)
      if not dcs_end then
        pending = pending:sub(dcs_start)
        return table.concat(output)
      end

      local body = pending:sub(dcs_start + 2, dcs_end - 2)
      if body:match('^tmux;') then
        local inner = body:sub(6)
        local decoded = inner:gsub('\027\027', '\027')
        output[#output + 1] = decoded
      else
        output[#output + 1] = pending:sub(dcs_start, dcs_end)
      end

      pos = dcs_end + 1
    end

    pending = ''
    return table.concat(output)
  end
end

-- Track whether the terminal app is on the alternate screen buffer (alt mode),
-- e.g. vim/less/htop. Scans the raw output for the DEC private mode toggles
-- 1049/1047/47 and records the latest state on the buffer.
local function update_alt_screen(bufnr, raw)
  for code, action in raw:gmatch('\027%[%?(%d+)(%a)') do
    if code == '1049' or code == '1047' or code == '47' then
      vim.b[bufnr].neoterm_alt_screen = (action == 'h')
    end
  end
end

local M = {}

function M.open_filtered_terminal(cmd, opts)
  opts = opts or {}
  local bufnr = vim.api.nvim_get_current_buf()
  local win = vim.api.nvim_get_current_win()
  local job_id
  local filter = create_dcs_filter()

  local term_chan = vim.api.nvim_open_term(bufnr, {
    on_input = function(_, _, _, data)
      if job_id then
        vim.fn.chansend(job_id, data)
      end
    end,
  })

  -- jobstart({pty=true}) defaults the child's TERM to "ansi", which lacks
  -- alternate-screen (smcup/rmcup) and 256-color capabilities. Give it a proper
  -- terminfo so full-screen apps (vim/less/htop) switch to the alt screen (and
  -- emit ?1049h, which update_alt_screen relies on) and render colors correctly.
  local env = vim.tbl_extend('force', {
    TERM = 'xterm-256color',
    COLORTERM = 'truecolor',
  }, opts.env or {})

  job_id = vim.fn.jobstart(cmd, {
    pty = true,
    env = env,
    cwd = opts.cwd,
    width = vim.api.nvim_win_get_width(win),
    height = vim.api.nvim_win_get_height(win),
    on_stdout = function(_, data)
      local raw = table.concat(data, '\n')
      if #raw == 0 then return end
      update_alt_screen(bufnr, raw)
      local filtered = filter(raw)
      if #filtered > 0 then
        vim.api.nvim_chan_send(term_chan, filtered)
      end
    end,
    on_exit = function(job_id_arg, exit_code)
      job_id = nil
      if opts.on_exit then
        opts.on_exit(job_id_arg, exit_code)
      end
    end,
  })

  vim.api.nvim_create_autocmd('WinResized', {
    callback = function()
      if not job_id or vim.fn.bufexists(bufnr) == 0 then
        return true
      end
      local w = vim.fn.bufwinid(bufnr)
      if w == -1 then return end
      for _, resized in ipairs(vim.v.event.windows) do
        if resized == w then
          pcall(vim.fn.jobresize, job_id, vim.api.nvim_win_get_width(w), vim.api.nvim_win_get_height(w))
          break
        end
      end
    end,
  })

  return job_id
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

  M.open_filtered_terminal(cmd, {
    cwd = path,
    on_exit = function(_, status)
      close_on_exit(bufnr, nil, status)
    end,
  })

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
vim.keymap.set({'n', 't'}, '<c-space>-', function ()
  start_terminal({split="horizontal"})
end, { noremap = true, silent = true })
vim.keymap.set({'n', 't'}, '<c-space>c',  function ()
  start_terminal({split="tab"})
end, { noremap = true, silent = true })
vim.keymap.set({'n', 't', 'v', 'i'}, '<c-space><c-t>',  function ()
  start_terminal({split="tab"})
end, { noremap = true, silent = true })
vim.keymap.set({'n', 't', 'v', 'i'}, '<c-space>N',  function ()
  start_terminal({split="tab"})
end, { noremap = true, silent = true })

vim.keymap.set("t", "<4-ScrollWheelUp>", '<nop>', { noremap = true })
vim.keymap.set("t", "<3-ScrollWheelUp>", '<nop>', { noremap = true })
vim.keymap.set("t", "<2-ScrollWheelUp>", '<nop>', { noremap = true })
vim.keymap.set("t", "<4-ScrollWheelDown>", '<nop>', { noremap = true })
vim.keymap.set("t", "<3-ScrollWheelDown>", '<nop>', { noremap = true })
vim.keymap.set("t", "<2-ScrollWheelDown>", '<nop>', { noremap = true })

-- When scrolling the mouse wheel over a terminal that is on the alternate screen
-- (alt mode, e.g. vim/less/htop), focus that terminal, enter terminal mode, and
-- forward the scroll into the running app instead of moving neovim's window view.
-- The window under the pointer (getmousepos) may differ from the focused window,
-- and the wheel can be spun from any mode, so this is a global mapping for
-- normal/visual/insert that always acts on the pointed-at window.
local function forward_scroll_in_alt(keys)
  return function ()
    local mouse_winid = vim.fn.getmousepos().winid
    local target_buf = mouse_winid ~= 0
      and vim.api.nvim_win_get_buf(mouse_winid)
      or nil

    if target_buf
      and vim.bo[target_buf].buftype == "terminal"
      and vim.b[target_buf].neoterm_alt_screen then
      -- Leave the current mode synchronously (works from normal/visual/insert)
      -- so the focus switch and the following `i` land cleanly, then forward the
      -- scroll into the terminal app.
      vim_utils.feedkeys("<C-\\><C-N>", "nx")
      if mouse_winid ~= vim.api.nvim_get_current_win() then
        vim.api.nvim_set_current_win(mouse_winid)
      end
      vim_utils.feedkeys("i" .. keys, "n")
      return
    end

    -- Default: replay the scroll (builtin scrolls the window under the pointer's
    -- viewport). Use noremap ("n") to avoid re-triggering this mapping.
    vim_utils.feedkeys(keys, "n")
  end
end

for _, key in ipairs({"<ScrollWheelUp>", "<ScrollWheelDown>"}) do
  vim.keymap.set({"n", "v", "i"}, key, forward_scroll_in_alt(key), { silent = true })
end


local au_group = vim.api.nvim_create_augroup("NeovimTerminalGroup", { clear = true })

-- Remember whether each terminal was in Terminal-mode (insert) so it can be
-- restored when the window is focused again. Navigating away with a mapping like
-- <c-space>h escapes to normal mode (<c-\><c-n>) as a side effect, so the mode
-- can't simply be read on BufLeave. Instead track TermEnter (user is in insert)
-- and defer the TermLeave reset with a short delay: once things have settled, if
-- we're still in the same terminal window the user genuinely switched to normal
-- mode; if the window changed, the escape was only part of navigating away, so
-- insert should persist. A next-tick schedule is too eager to see the window
-- change land, so use a small timer.
local NEOTERM_MODE_SETTLE_MS = 50

vim.api.nvim_create_autocmd("TermEnter", {
  pattern = "*",
  group = au_group,
  callback = function (args)
    vim.b[args.buf].neoterm_insert = true
  end
})

vim.api.nvim_create_autocmd("TermLeave", {
  pattern = "*",
  group = au_group,
  callback = function (args)
    local buf = args.buf
    local win = vim.api.nvim_get_current_win()
    vim.defer_fn(function ()
      if vim.api.nvim_buf_is_valid(buf)
        and vim.api.nvim_win_is_valid(win)
        and vim.api.nvim_get_current_win() == win
        and vim.api.nvim_win_get_buf(win) == buf then
        vim.b[buf].neoterm_insert = false
      end
    end, NEOTERM_MODE_SETTLE_MS)
  end
})

vim.api.nvim_create_autocmd({ "BufWinEnter", "WinEnter", "BufEnter" }, {
  pattern = "*",
  group = au_group,
  callback = function (args)
    -- These terminals are created with nvim_open_term, so the buffer name is not
    -- "term://*"; match every buffer and filter by buftype instead.
    if vim.bo[args.buf].buftype ~= "terminal" then return end
    -- Default (flag unset) to insert to preserve the original behaviour.
    if vim.b[args.buf].neoterm_insert ~= false then
      vim.cmd.startinsert()
    else
      vim.cmd.stopinsert()
    end
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

local function copyVisualSelection ()
  local selection = vim_utils.get_visual_selection("char")
  if #selection > 1 then
    vim.fn.setreg("+", selection)
  end
end


vim.api.nvim_create_autocmd("TermOpen", {
  pattern = "*",
  group = au_group,
  callback = function ()
    vim.keymap.set("n", "q", "i", { buffer = true })
    vim.opt_local.number = false
    vim.opt_local.relativenumber = false
    vim.opt_local.scrollback = 10000
    vim.cmd.startinsert()

    vim.keymap.set("n", "<cr>", vim.cmd.startinsert, {buffer = true})
    vim.keymap.set({"v", "s"}, "<cr>", "<esc>i", {buffer = true, remap = false})
    vim.keymap.set("x", "<LeftRelease>", copyVisualSelection, {buffer = true, remap = false})
    vim.keymap.set("x", "<2-LeftRelease>", copyVisualSelection, {buffer = true, remap = false})
  end
})

-- local last_term_request_buf = nil

vim.api.nvim_create_autocmd('TermRequest', {
  group = au_group,
  callback = function(args)
    local seq = args.data.sequence
    if seq:match('^\027]9;') or seq:match('^\027]52;') then
      local terminator = args.data.terminator or '\027\\'
      io.stdout:write(seq .. terminator)
      io.stdout:flush()
    end
  end,
})

-- vim.api.nvim_create_autocmd('TermResponse', {
--   group = au_group,
--   callback = function(args)
--     if last_term_request_buf
--       and vim.api.nvim_buf_is_valid(last_term_request_buf) then
--       local channel = vim.bo[last_term_request_buf].channel
--       if channel and channel > 0 then
--         vim.api.nvim_chan_send(channel, args.data.sequence)
--       end
--     end
--   end,
-- })

local function find_fallback_terminal()
  local terminals = {}
  local channel
  local windows = vim.api.nvim_tabpage_list_wins(0)
  for _, window in ipairs(windows) do
    local buf = vim.api.nvim_win_get_buf(window)
    local buftype = vim.bo[buf].buftype
    if buftype == "terminal" then
      terminals[#terminals + 1] = window
    end
  end

  if #terminals == 1 then
    local terminal = terminals[1]
    local term_buf = vim.api.nvim_win_get_buf(terminal)
    local term_channel = vim.bo[term_buf].channel
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

return M
