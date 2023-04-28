" Display incomplete commands.
set shell=bash

set cmdheight=2

set showcmd

set wildignorecase

set shortmess+=I
" Ignore completion messages
set shortmess+=c

" By default use four spaces
set shiftwidth=4
set expandtab

" Handle multiple buffers better.
set hidden


if has('nvim')
  set wildoptions=pum
else
  " Complete files like a shell.
  set wildmode=list:longest,full
endif

" No extra spaces when joining lines
set nojoinspaces

" Case-insensitive searching.
set ignorecase

" Show line numbers.
set number
set relativenumber

set wrap
" Show 3 lines of context around the cursor.
set scrolloff=3

" Disable preview window
set completeopt-=preview

set completeopt+=menuone,noselect

" Set comment line break when editing comments
set formatoptions+=ro

" Set the terminal's title
set title
" No beeping.
set visualbell

" Don't make a backup before overwriting a file.
set nobackup
" And again.
set nowritebackup
" Keep swap files in one location
set directory=$HOME/.config/nvim/tmp//,.

" Always diff using vertical mode
set diffopt+=vertical

" Allows the mouse to be used
set mouse=a

" Set position of quickfix
botright cwindow

" Copy to system register
" set clipboard=unnamed

" Set virtual edit
set virtualedit=block,onemore

set cursorline
set listchars=tab:▸\ ,eol:¬
set splitbelow
set splitright
set linebreak
let &breakat=" \<tab>(),"
set breakindent
set noshowmode
set updatetime=500
set sidescroll=2
set showbreak=↪\ 
set tabstop=4
set keywordprg=:help

" Splits should use full line just like Tmux
set fillchars+=vert:│

if has('nvim')
  set termguicolors

  " Sets the colorscheme for terminal sessions too.
  set background=dark

  try
	execute "colorscheme" g:my_colorscheme
  catch
  endtry
endif

if exists('&inccommand')
  set inccommand=split
endif

" Files open expanded
" Use decent folding
if has('vim_starting')
  set foldlevelstart=50
  set foldmethod=indent
endif

" Dever a redraw of the screen so the cursor appears
" in the windows terminal. Without it, for some reason,
" the cursor will be invisible at the beginning of the program.
" This likely has something to do with other actions that
" are defered during Vim load time, and some bug that makes
" the windows terminal have a problem.
call auto#defer_cmd("redraw")

set signcolumn=yes
