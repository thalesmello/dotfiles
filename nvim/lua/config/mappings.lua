vim.keymap.set("n", "<c-h>", "<c-w>h", { remap = true })
vim.keymap.set("n", "<c-l>", "<c-w>l", { remap = true })
vim.keymap.set("n", "<c-j>", "<c-w>j", { remap = true })
vim.keymap.set("n", "<c-k>", "<c-w>k", { remap = true })
vim.keymap.set("n", "<leader><c-p>", ":tabprevious<cr>", { remap = true })
vim.keymap.set("n", "<leader><c-n>", ":tabnext<cr>", { remap = true })

-- Create windows
vim.keymap.set("n", "<leader>v", "<C-w>v", { remap = true })
vim.keymap.set("n", "<leader>%", "<C-w>v", { remap = true })
vim.keymap.set("n", '<leader>"', "<C-w>s", { remap = true })
vim.keymap.set("n", "<leader><bs>", "<c-w>q", { remap = true })

-- Edit and load vimrc
vim.keymap.set("n", "<leader>ev", ":edit $MYVIMRC<cr>", { noremap = true })
vim.keymap.set("n", "<leader>el", ":edit ~/.nvim_local.lua<cr>", { noremap = true })
vim.keymap.set("n", "<leader>ep", ":edit $MYVIMRC<cr>:Eplugin<space>", { noremap = true })
vim.keymap.set("n", "<leader>ec", ":edit $MYVIMRC<cr>:Econfig<space>", { noremap = true })

vim.keymap.set("n", "<leader>s%", function ()
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

vim.keymap.set("v", "@", ":<c-u>noautocmd '<,'> normal @", { noremap = true })
vim.keymap.set("n", "<leader><leader>", "<c-^>", { noremap = true })
vim.keymap.set("n", "<leader>o", function ()
    return vim.deep_equal(vim.fn.getpos('.'), vim.fn.getpos("']")) and "`[" or "`]"
  end, { noremap = true, expr = true })
vim.keymap.set("x", "<leader>c*", "*Ncgn", { remap=true })
vim.keymap.set("n", "c*", "*Ncgn")
-- vim.keymap.set("n", "<leader>a", "ea")
vim.keymap.set("n", "<leader>A", "vi.oA", {remap = true})
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
  local x = vim.fn.nr2char(vim.fn.getchar())

  vim.api.nvim_create_autocmd("CmdlineEnter", {
    pattern = "*",
    callback = function ()

      local registerText = vim.fn.getreg(x)
      -- There a funny bug that causes a sequence to be recorded in the macro when f or t are pressed.
      -- We remove it in the line below
      registerText = vim.fn.substitute(registerText, "€ý5", "", "g")
      local str = 'lua vim.fn.setreg(\'' .. x .. '\', [=[' .. registerText .. "]=])"
      local _, end_idx = str:find('[=[', 1, true)
      vim.fn.setcmdline(str, end_idx + 1)
    end,
    once = true,
  })

  vim.fn.feedkeys(':', 'n')
end)

vim.keymap.set("n", "<bs>", ":nohlsearch<cr>:pclose<cr>:diffoff<cr>", { noremap = true, silent = true })
vim.keymap.set("s", "<bs>", "<bs>i", { noremap = true })
vim.keymap.set("n", "<leader>ft", ':setfiletype<space>', { noremap = true })

vim.keymap.set("c", "<c-9>", '\\(\\)<left><left>', { noremap = true })
vim.keymap.set("c", "<c-_>", '\\{-}', { noremap = true })
vim.keymap.set("c", "<c-->", '\\{-}', { noremap = true })


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
    'Opens filepath or URI under cursor with the system handler (file explorer, web browser, â€¦)'
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
