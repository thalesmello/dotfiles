-- Display incomplete commands.
vim.opt.shell = "bash"

vim.opt.cmdheight = 2

vim.opt.showcmd = true

vim.opt.wildignorecase = true

vim.opt.shortmess:append("I")
-- Ignore completion messages
vim.opt.shortmess:append("c")

-- By default use four spaces
vim.opt.shiftwidth = 4
vim.opt.expandtab = true

-- Handle multiple buffers better.
vim.opt.hidden = true


vim.opt.wildoptions = "pum"

-- No extra spaces when joining lines
vim.opt.joinspaces = false

-- Case-insensitive searching.
vim.opt.ignorecase = true

-- Show line numbers.
vim.opt.number = true
vim.opt.relativenumber = true

vim.opt.wrap = true
-- Show 3 lines of context around the cursor.
vim.opt.scrolloff = 3

-- Disable preview window
vim.opt.completeopt:remove { "preview" }
vim.opt.completeopt:append { "menuone", "noselect" }

-- Set comment line break when editing comments
vim.opt.formatoptions:append { "ro" }

-- Set the terminal's title
vim.opt.title = true
-- No beeping.
vim.opt.visualbell = true

-- Don't make a backup before overwriting a file.
vim.opt.backup = false
-- And again.
vim.opt.writebackup = false
-- Keep swap files in one location
vim.opt.directory={ vim.env.HOME .. "/.config/nvim/tmp//", "." }

-- Always diff using vertical mode
vim.opt.diffopt:append { "vertical" }

-- Allows the mouse to be used
vim.opt.mouse = "a"

-- Set position of quickfix
vim.cmd("botright cwindow")

-- Copy to system register
-- set clipboard=unnamed

-- Set virtual edit
vim.cmd.virtualedit={ "block", "onemore" }

vim.opt.cursorline = true
vim.cmd.listchars={ tab = "▸ ", eol = "¬" }
vim.opt.splitbelow = true
vim.opt.splitright = true
vim.opt.linebreak = true
vim.opt.breakat = " 	(),"
vim.opt.breakindent = true
vim.opt.showmode = false
vim.opt.updatetime = 500
vim.opt.sidescroll = 2
vim.opt.showbreak = "↪ "
vim.opt.tabstop = 4
vim.opt.keywordprg = ":help"

-- Splits should use full line just like Tmux
vim.opt.fillchars:append { vert = "│" }

vim.opt.termguicolors = true

-- Sets the colorscheme for terminal sessions too.
vim.opt.background = "dark"

vim.cmd.colorscheme(vim.g.my_colorscheme)

vim.opt.inccommand = "split"

-- Files open expanded
-- Use decent folding
if vim.fn.has('vim_starting') ~= 0 then
  vim.opt.foldlevelstart = 50
  vim.opt.foldmethod = "indent"
end

vim.opt.signcolumn = "yes"
