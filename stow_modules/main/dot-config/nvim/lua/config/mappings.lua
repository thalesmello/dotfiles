vim.keymap.set({"n", "v"}, "<c-h>", "<c-w>h", { remap = false })
vim.keymap.set({"n", "v"}, "<c-l>", "<c-w>l", { remap = false })
vim.keymap.set({"n", "v"}, "<c-j>", "<c-w>j", { remap = false })
vim.keymap.set({"n", "v"}, "<c-k>", "<c-w>k", { remap = false })
vim.keymap.set({"n", "v"}, "<C-S-h>", "<c-w>h", { remap = false })
vim.keymap.set({"n", "v"}, "<C-S-l>", "<c-w>l", { remap = false })
vim.keymap.set({"n", "v"}, "<C-S-j>", "<c-w>j", { remap = false })
vim.keymap.set({"n", "v"}, "<C-S-k>", "<c-w>k", { remap = false })
vim.keymap.set({"t"}, "<C-S-h>", "<c-\\><c-n><c-w>h", { remap = false })
vim.keymap.set({"t"}, "<C-S-l>", "<c-\\><c-n><c-w>l", { remap = false })
vim.keymap.set({"t"}, "<C-S-j>", "<c-\\><c-n><c-w>j", { remap = false })
vim.keymap.set({"t"}, "<C-S-k>", "<c-\\><c-n><c-w>k", { remap = false })
vim.keymap.set({"n", "v"}, "<M-C-h>", "<c-w>h", { remap = false })
vim.keymap.set({"n", "v"}, "<M-C-l>", "<c-w>l", { remap = false })
vim.keymap.set({"n", "v"}, "<M-C-j>", "<c-w>j", { remap = false })
vim.keymap.set({"n", "v"}, "<M-C-k>", "<c-w>k", { remap = false })
vim.keymap.set({"t"}, "<M-C-h>", "<c-\\><c-n><c-w>h", { remap = false })
vim.keymap.set({"t"}, "<M-C-l>", "<c-\\><c-n><c-w>l", { remap = false })
vim.keymap.set({"t"}, "<M-C-j>", "<c-\\><c-n><c-w>j", { remap = false })
vim.keymap.set({"t"}, "<M-C-k>", "<c-\\><c-n><c-w>k", { remap = false })
vim.keymap.set("n", "[<Tab>", "<cmd>tabprevious<cr>", { remap = false })
vim.keymap.set("n", "]<Tab>", "<cmd>tabnext<cr>", { remap = false })
vim.keymap.set("n", "<leader>ww", "<cmd>w<cr>", { remap = false })
vim.keymap.set({"n", "x", "o"}, "H", "^", { remap = false })
vim.keymap.set({"n", "x", "o"}, "L", "$", { remap = false })
vim.keymap.set({"n", "x", "o"}, "<leader>me", "<cmd>messages<cr>", { remap = false })
vim.keymap.set({"n", "v"}, "z-", "zMzv", { remap = false })

local lineContinuationToggle = [=[:luado if line:match('\\?%s*#.*$') ~= nil then return line:gsub('^(%s*)\\?.-# ', '%1') elseif vim.fn.getline('.'):match('\\$') then return line:gsub('^(%s*)(%S-.-)$', '%1\\ # %2') else return line:gsub('^(%s*)(%S-.-)$', '%1# %2') end<cr>]=]

vim.keymap.set({'x'}, 'g\\', lineContinuationToggle, { silent = true })
vim.keymap.set({'n'}, 'g\\\\', "V" .. lineContinuationToggle, { silent = true })

-- Create windows
vim.keymap.set("n", "<leader>v", "<C-w>v", { remap = true })
vim.keymap.set("n", "<leader>%", "<C-w>v", { remap = true })
vim.keymap.set("n", '<leader>"', "<C-w>s", { remap = true })
vim.keymap.set("n", '<leader>-', "<C-w>s", { remap = true })
vim.keymap.set("n", "<leader><bs>", "<c-w>q", { remap = true })

-- Edit and load vimrc
vim.keymap.set("n", "<leader>ev", ":edit $MYVIMRC<cr>", { noremap = true })
vim.keymap.set("n", "<leader>esk", ":edit ~/.skhdrc_main<cr>", { noremap = true })
vim.keymap.set("n", "<leader>ehs", ":edit ~/.hammerspoon/init.lua<cr>", { noremap = true })
vim.keymap.set("n", "<leader>ekb", ":edit ~/.hammerspoon/keybindings.lua<cr>", { noremap = true })
vim.keymap.set("n", "<leader>el", ":edit ~/.local_dotfiles/nvim/init.lua<cr>", { noremap = true })
vim.keymap.set("n", "<leader>ep", ":edit $MYVIMRC<cr>:Eplugin<space>", { noremap = true })
vim.keymap.set("n", "<leader>ec", ":edit $MYVIMRC<cr>:Econfig<space>", { noremap = true })

vim.keymap.set("n", "<leader>sb", function ()
  if vim.list_contains({"lua", "vim"}, vim.o.filetype) then
    vim.cmd.source("%")
  end
end)

vim.keymap.set("n", "<leader>gcc", function ()
  vim.cmd.normal("yyPgccj")
end)

vim.keymap.set("v", "<leader>gc", function ()
  vim.cmd.normal("y`]`[gc`]`]p")
end)

-- Fix syntax highlighting
-- vim.keymap.set("n", "<leader>sf", "<cmd>syntax sync fromstart<cr>", { noremap = true })

vim.keymap.set("c", "<c-n>", function ()
  -- return vim.fn.pumvisible() ~= 0 and "<c-n>" or "<down>"
  return "<down>"
end, { noremap = true, expr = true })

vim.keymap.set("c", "<c-p>", function ()
  return "<up>"
end, { noremap = true, expr = true })

-- The snippet below tries to intelligently split a string and append a concat
-- operator in it

vim.keymap.set("n", "<leader>y", '"+y', { noremap = true })
vim.keymap.set("n", "<leader>Y", '"+y$', { noremap = true })
vim.keymap.set("n", "<leader>p", '"+p', { noremap = true })
vim.keymap.set("n", "<leader>P", '"+P', { noremap = true })

vim.keymap.set("v", "<leader>y", '"+y', { noremap = true })
vim.keymap.set("v", "<leader>p", '"+p', { noremap = true })
vim.keymap.set("v", "<leader>P", '"+P', { noremap = true })

vim.keymap.set("v", "<M-w>", '"+ygv', { noremap = true })

vim.keymap.set({ "n", "x" }, "x", '"_x', { remap = false })
vim.keymap.set({ "n", "x" }, "X", '"_X', { remap = false })
vim.keymap.set({ "n" }, "xp", '"xx"xp', { remap = false })

vim.keymap.set("v", "@", ":<c-u>noautocmd '<,'> normal @", { noremap = true })
vim.keymap.set("n", "<leader><leader>", "<c-^>", { noremap = true })
vim.keymap.set("n", "<leader>o", function ()
    return vim.deep_equal(vim.fn.getpos('.'), vim.fn.getpos("']")) and "`[" or "`]"
  end, { noremap = true, expr = true })
vim.keymap.set({"n", "x"}, "<leader>*", "*Nzz", { remap=true })
vim.keymap.set("x", "<leader>c*", "*Ncgn", { remap=true })
vim.keymap.set("n", "c*", "*Ncgn")
vim.keymap.set("n", "Y", "y$", { noremap = true })
vim.keymap.set({"n", "v", "o"}, "<c-e>", "2<c-e>" , {noremap = true})
vim.keymap.set({"n", "v", "o"}, "<c-y>", "2<c-y>" , {noremap = true})
vim.keymap.set("n", "<leader>=", "<c-w>=", { noremap = true })
vim.keymap.set("n", "<leader>+", "<c-w>|<c-w>_", { noremap = true })
vim.keymap.set("n", "<leader>|", "<c-w>|", { noremap = true })

vim.keymap.set("n", "<S-ScrollWheelUp>", "<ScrollWheelLeft>", { noremap = true })
vim.keymap.set("n", "<S-2-ScrollWheelUp>", "<2-ScrollWheelLeft>", { noremap = true })
vim.keymap.set("n", "<S-3-ScrollWheelUp>", "<3-ScrollWheelLeft>", { noremap = true })
vim.keymap.set("n", "<S-4-ScrollWheelUp>", "<4-ScrollWheelLeft>", { noremap = true })
vim.keymap.set("n", "<S-ScrollWheelDown>", "<ScrollWheelRight>", { noremap = true })
vim.keymap.set("n", "<S-2-ScrollWheelDown>", "<2-ScrollWheelRight>", { noremap = true })
vim.keymap.set("n", "<S-3-ScrollWheelDown>", "<3-ScrollWheelRight>", { noremap = true })
vim.keymap.set("n", "<S-4-ScrollWheelDown>", "<4-ScrollWheelRight>", { noremap = true })

-- Silence write file so it doesn't pollute history
-- vim.keymap.set("n", ":w<cr>", ":write<cr>", { noremap = true })
-- vim.keymap.set("n", ":q<cr>", ":quit<cr>", { noremap = true })

vim.keymap.set({"v"}, ":", "<esc>gv<Plug>SwapVisualCursor", { remap = true })
vim.keymap.set({"v"}, "<Plug>SwapVisualCursor", function ()
  return vim.fn.line(".") == vim.fn.line("'<") and ":" or "o:"
end, { noremap = true, expr = true })

vim.keymap.set("n", "<leader>er", function ()
  local reg = vim.fn.nr2char(vim.fn.getchar())

  vim.api.nvim_create_autocmd("CmdlineEnter", {
    pattern = "*",
    callback = function ()

      local macro = vim.fn.getreg(reg)
      -- There a funny bug that causes a sequence to be recorded in the macro when f or t are pressed.
      -- We remove it in the line below
      local escaped_macro = require("reverse_termcodes").reverse_termcodes(macro)

      local quoted_macro

      if not escaped_macro:find("'") then
        quoted_macro = "'" .. escaped_macro .. "'"
      elseif not escaped_macro:find('"') then
        quoted_macro = '"' .. escaped_macro .. '"'
      elseif (not escaped_macro:find("%[%["))
        and (not escaped_macro:find("%]%]")) then
        quoted_macro = "[[" .. escaped_macro .. "]]"
      else
        quoted_macro = "[=[" .. escaped_macro .. "]=]"
      end

      local str = "lua require'vim_utils'.set_register('" .. reg .. "', " .. quoted_macro .. ")"

      vim.fn.setcmdline(str)
    end,
    once = true,
  })

  vim.fn.feedkeys(':', 'n')
end)

vim.api.nvim_create_autocmd({ 'VimResized' }, {
  group = vim.api.nvim_create_augroup('VimResizeWindows', { clear = true }),
  pattern = {"*"},
  callback = function()
    vim.cmd.wincmd("=")
  end,
})

vim.keymap.set("n", "<bs>", ":nohlsearch<cr>:pclose<cr>:diffoff<cr>:cclose<cr>", { noremap = true, silent = true })
vim.keymap.set("s", "<bs>", "<bs>i", { noremap = true })
vim.keymap.set("n", "<leader>ft", ':setfiletype<space>', { noremap = true })

vim.keymap.set("c", "<c-9>", '\\(\\)<left><left>', { noremap = true })
vim.keymap.set("c", "<c-_>", '\\{-}', { noremap = true })
vim.keymap.set("c", "<c-->", '\\{-}', { noremap = true })

-- Map default C-t
vim.keymap.set("n", "<leader><c-t>", '<c-t>', { noremap = true })

-- Jump through the jumplist stopping at file boundaries, then let the plain
-- <c-o>/<c-i> navigate back and forth within the reached file.
--   <leader><c-o>: jump backward to the nearest entry in a different file.
--   <leader><c-i>: jump forward to the last entry of the next different file,
--                  so a subsequent <c-i> crosses into yet another file.
local function jump_to_different_file(direction)
  local jl = vim.fn.getjumplist()
  local jumps = jl[1]
  local len = #jumps
  -- getjumplist returns a 0-based index; the current position sits at
  -- jumps[cur_pos] (or just past the end when cur_pos > len).
  local cur_pos = jl[2] + 1
  local ref = vim.api.nvim_get_current_buf()

  local function valid(entry)
    return entry ~= nil and entry.bufnr > 0 and vim.api.nvim_buf_is_valid(entry.bufnr)
  end

  local target

  if direction < 0 then
    -- Walk backward, skipping the current file, to the first different file.
    local i = cur_pos - 1
    while i >= 1 and (not valid(jumps[i]) or jumps[i].bufnr == ref) do
      i = i - 1
    end
    if i >= 1 then target = i end
  else
    -- Walk forward past the current file to the next different file...
    local i = cur_pos + 1
    while i <= len and (not valid(jumps[i]) or jumps[i].bufnr == ref) do
      i = i + 1
    end
    if i <= len then
      -- ...then advance to the last consecutive entry of that file.
      local buf = jumps[i].bufnr
      while i + 1 <= len and valid(jumps[i + 1]) and jumps[i + 1].bufnr == buf do
        i = i + 1
      end
      target = i
    end
  end

  if target == nil then return end

  local count = math.abs(target - cur_pos)
  local key = vim.api.nvim_replace_termcodes(direction < 0 and "<c-o>" or "<c-i>", true, false, true)
  vim.api.nvim_feedkeys(count .. key, "n", false)
end

vim.keymap.set("n", "<leader><c-o>", function () jump_to_different_file(-1) end, { noremap = true })
vim.keymap.set("n", "<leader><c-i>", function () jump_to_different_file(1) end, { noremap = true })

vim.keymap.set({"n", "v"}, "<leader>z", function ()
  if vim.g.fuzzy_finder_to_resume == 'fzf' then
    vim.cmd.FzfLua('resume')
  elseif vim.g.fuzzy_finder_to_resume == "telescope" then
    vim.cmd.Telescope('resume')
  else
    vim.health.error("no fuzzy finder to resume. Use fzf or telescope first")
  end
end)

--- Map |gx| to call |vim.ui.open| on the <cfile> at cursor.
do
  local function do_open(uri)
    local cmd, err = vim.ui.open(uri)
    local rv = cmd and cmd:wait(1000) or nil
    if cmd and rv and rv.code ~= 0 then
      err = ('vim.ui.open: command %s (%d): %s'):format(
        (rv.code == 124 and 'timeout' or 'failed'),
        rv.code,
        vim.inspect(cmd.cmd)
      )
    end

    if err then
      vim.notify(err, vim.log.levels.ERROR)
    end
  end

  local gx_desc =
    'Opens filepath or URI under cursor with the system handler (file explorer, web browser, …)'
  vim.keymap.set({ 'n' }, '<leader>gx', function()
    do_open(vim.fn.expand('<cfile>'))
  end, { desc = gx_desc })
  vim.keymap.set({ 'x' }, '<leader>gx', function()
    local lines =
      vim.fn.getregion(vim.fn.getpos('.'), vim.fn.getpos('v'), { type = vim.fn.mode() })
    -- Trim whitespace on each line and concatenate.
    do_open(table.concat(vim.iter(lines):map(vim.trim):totable()))
  end, { desc = gx_desc })
end

local function merge_tab(direction)
  -- Get current tabpage and buffer
  local current_tab = vim.api.nvim_get_current_tabpage()
  local current_buf = vim.api.nvim_get_current_buf()

  -- Get current tab number
  local current_tab_nr = vim.api.nvim_tabpage_get_number(current_tab)

  -- Move to previous tabpage
  vim.cmd('tab'..direction)

  -- Open vertical split in previous tabpage
  vim.cmd('vertical sbuffer '..current_buf)

  -- Set the buffer in the new split
  vim.api.nvim_set_current_buf(current_buf)

  -- Go back to original tab to close it
  vim.cmd(current_tab_nr .. 'tabclose')
end

vim.keymap.set("n", "<leader>gt", function () merge_tab("next") end)
vim.keymap.set("n", "<leader>gT", function () merge_tab("prev") end)
