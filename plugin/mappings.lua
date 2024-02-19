-- Navigation shortcuts
vim.keymap.set("n", "<c-h>", "<c-w>h", { noremap = true })
vim.keymap.set("n", "<c-l>", "<c-w>l", { noremap = true })
vim.keymap.set("n", "<c-j>", "<c-w>j", { noremap = true })
vim.keymap.set("n", "<c-k>", "<c-w>k", { noremap = true })
vim.keymap.set("n", "<leader><c-p>", ":tabprevious<cr>", { noremap = true })
vim.keymap.set("n", "<leader><c-n>", ":tabnext<cr>", { noremap = true })

vim.keymap.set("n", "<leader>1", "1gt", { noremap = true })
vim.keymap.set("n", "<leader>2", "2gt", { noremap = true })
vim.keymap.set("n", "<leader>3", "3gt", { noremap = true })
vim.keymap.set("n", "<leader>4", "4gt", { noremap = true })
vim.keymap.set("n", "<leader>5", "5gt", { noremap = true })
vim.keymap.set("n", "<leader>6", "6gt", { noremap = true })
vim.keymap.set("n", "<leader>7", "7gt", { noremap = true })
vim.keymap.set("n", "<leader>8", "8gt", { noremap = true })
vim.keymap.set("n", "<leader>9", "9gt", { noremap = true })

-- Create windows
vim.keymap.set("n", "<leader>v", "<C-w>v", { noremap = true })
vim.keymap.set("n", "<leader>%", "<C-w>v", { noremap = true })
vim.keymap.set("n", '<leader>"', "<C-w>s", { noremap = true })
vim.keymap.set("n", "<leader><bs>", "<c-w>q", { noremap = true })

-- Edit and load vimrc
vim.keymap.set("n", "<leader>ev", ":vsplit $MYVIMRC<cr>", { noremap = true })
vim.keymap.set("n", "<leader>ec", ":vsplit $MYVIMRC<cr>:Econfig<space>", { noremap = true })
vim.keymap.set("n", "<leader>ea", ":vsplit $MYVIMRC<cr>:Eautoload<space>", { noremap = true })
vim.keymap.set("n", "<leader>s%", ":if &ft == 'vim' <bar> source % <bar> endif<cr>", { noremap = true })

-- Fix syntax highlighting
vim.keymap.set("n", "<leader>sf", "<cmd>syntax sync fromstart<cr>", { noremap = true })

-- Smart lookup for command line
vim.keymap.set("c", "<c-n>", function ()
  return vim.fn.pumvisible() ~= 0 and "<c-n>" or "<down>"
end, { noremap = true, expr = true })
vim.keymap.set("c", "<c-p>", function ()
  return vim.fn.pumvisible() ~= 0 and "<c-p>" or "<up>"
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
    return vim.fn.getpos('.') == vim.fn.getpos("'[") and "`]" or "`["
  end, { noremap = true, expr = true })
vim.keymap.set("v", "<leader>c*", "*Ncgn")
vim.keymap.set("n", "c*", "*Ncgn")
vim.keymap.set("n", "Y", "y$", { noremap = true })
vim.keymap.set("n", "<leader>fw", ":FixWhitespace<cr>", { noremap = true })
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
vim.keymap.set("n", ":w<cr>", ":write<cr>", { noremap = true })
vim.keymap.set("n", ":q<cr>", ":quit<cr>", { noremap = true })

-- Make [[ navigation more useful for when { not in first column
vim.keymap.set({"n", "v", "o"}, "[[", "<cmd>keeppatterns normal ?{<c-v><cr>w99[{<CR>", { silent = true })
vim.keymap.set({"n", "v", "o"}, "][", "<cmd>keeppatterns normal /}<c-v><CR>b99]}<CR>", { silent = true })
vim.keymap.set({"n", "v", "o"}, "]]", "<cmd>keeppatterns normal j0[[%/{<c-v><cr><CR>", { silent = true })
vim.keymap.set({"n", "v", "o"}, "[]", "<cmd>keeppatterns normal k$][%?}<c-v><cr><CR>", { silent = true })

vim.keymap.set({"v"}, ":", "<esc>gv<Plug>SwapVisualCursor", { remap = true })
vim.keymap.set({"v"}, "<Plug>SwapVisualCursor", function ()
  return vim.fn.line(".") == vim.fn.line("'<") and ":" or "o:"
end, { noremap = true, expr = true })

vim.keymap.set("n", "<leader>er", function ()
  local x = vim.fn.nr2char(vim.fn.getchar())

  vim.api.nvim_create_autocmd("CmdlineEnter", {
    pattern = "*",
    callback = function ()
      --- @type string
      local str = 'lua vim.fn.setreg("' .. x .. '", [=[' .. vim.fn.getreg(x) .. "]=])"
      local _, end_idx = str:find('[=[', 1, true)
      vim.fn.setcmdline(str, end_idx + 1)
    end,
    once = true,
  })

  vim.fn.feedkeys(':', 'n')
end)

vim.keymap.set("n", "<bs>", ":nohlsearch<cr>:pclose<cr>:diffoff<cr>", { noremap = true })

