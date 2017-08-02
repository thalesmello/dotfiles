" Display incomplete commands.
set showcmd

set path+=**

set wildignorecase

set shortmess+=I
" Ignore completion messages
set shortmess+=c

" Handle multiple buffers better.
set hidden

" Complete files like a shell.
set wildmode=list:longest,full

" No extra spaces when joining lines
set nojoinspaces

" Case-insensitive searching.
set ignorecase

set shell=/usr/local/bin/zsh

" Show line numbers.
set number
set relativenumber

" Don't highlight matches.
set nohlsearch

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
set directory=$HOME/.vim/tmp//,.

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

" Sets the colorscheme for terminal sessions too.
set background=dark
colorscheme gruvbox

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
  let $NVIM_TUI_ENABLE_CURSOR_SHAPE = 1
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
