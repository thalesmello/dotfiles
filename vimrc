" .vimrc
" Author: Pedro Franceschi <pedrohfranceschi@gmail.com>
" Source: http://github.com/pedrofranceschi/vimfiles

" ##### Dein setup  {{{
set nocompatible " Be iMproved
filetype off     " required

" Required:
set runtimepath^=~/.vim/dein/repos/github.com/Shougo/dein.vim

" Required:
call dein#begin('~/.vim/dein')

" Let dein manage dein
" Required:
call dein#add('Shougo/dein.vim')

" "}}}
" ##### Plugins  {{{
" Plugin to load tasks asynchronously
call dein#add('Shougo/vimproc.vim', {'build' : 'make'})
" Theme of this vimfiles
call dein#add('sjl/badwolf')
" Fuzzy search file swithing with Ctrl+P
call dein#add('kien/ctrlp.vim')
" Useful statusbar in your vim
call dein#add('bling/vim-airline')
call dein#add('vim-airline/vim-airline-themes')
call dein#add('b4winckler/vim-objc')
" Comment toggling: use `gc` to toggle comments in visual mode
call dein#add('tomtom/tcomment_vim')
" Keybidings to use Ack in Vim. Use `<leader>a` in visual mode to search a
" text in the tree.
call dein#add('mileszs/ack.vim')
" Makes vim understand ruby blocks
call dein#add('kana/vim-textobj-user')
call dein#add('rhysd/vim-textobj-ruby')
" Git bindings for VIM
call dein#add('tpope/vim-fugitive')
" Surround utils for vim
call dein#add('tpope/vim-surround')
" Automatic closing of brackets
call dein#add('Raimondi/delimitMate')
" Makes vim understand markdown folding
call dein#add('nelstrom/vim-markdown-folding')
" Makes the repeat command `.` work in more cases
call dein#add('tpope/vim-repeat')
" Vim support for Js handlebars
call dein#add('nono/vim-handlebars')
call dein#add('nathanaelkane/vim-indent-guides')
" Javascript support for vim
call dein#add('pangloss/vim-javascript')
call dein#add('milkypostman/vim-togglelist')
" Relative line number
call dein#add('jeffkreeftmeijer/vim-numbertoggle')
" File explorer for VIM. <leader>ft to activate
call dein#add('scrooloose/nerdtree')
" Golang support for vim
call dein#add('jnwhiteh/vim-golang')
" Make jk behave as jumps in Vim
call dein#add('teranex/jk-jumps.vim')
call dein#add('tpope/vim-dispatch')
" Expand html easily: div > 3*li then Ctrl+e in an html file
call dein#add('rstacruz/sparkup')
" Use the Molokay font in Vim
call dein#add('tomasr/molokai')
" Puppet support for Vim
call dein#add('rodjek/vim-puppet')
" Elixir support for Vim
call dein#add('elixir-lang/vim-elixir')
" Ruby support for Vim
call dein#add('vim-ruby/vim-ruby')

" }}}
" ##### Load local Plugins  {{{

" The following loads a local bundles file, in case
" you wish to install local plugins
if filereadable(glob("~/.vimrc.bundles.local"))
    source ~/.vimrc.bundles.local
endif

" }}}
" ##### Finish loading Dein  {{{

" Required:
call dein#end()

" Required:
filetype plugin indent on

" If you want to install not installed plugins on startup.
if dein#check_install()
  call dein#install()
endif

" }}}
" ##### Basic options  {{{
" Display incomplete commands.
set showcmd
" Display the mode you're in.
set showmode

" Intuitive backspacing.
set backspace=indent,eol,start
" Handle multiple buffers better.
set hidden

" Enhanced command line completion.
set wildmenu
" Complete files like a shell.
set wildmode=list:longest

" Case-insensitive searching.
set ignorecase
" But case-sensitive if expression contains a capital letter.
set smartcase

" Show line numbers.
set number
" Show cursor position.
set ruler

" Highlight matches as you type.
set incsearch
" Don't highlight matches.
set nohlsearch

" Turn off line wrapping.
set nowrap
" Show 3 lines of context around the cursor.
set scrolloff=3

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

" Global tab width.
autocmd FileType * setlocal tabstop=4
" And again, related.
autocmd FileType * setlocal shiftwidth=4

" Files open expanded
set foldlevelstart=50
" Use decent folding
set foldmethod=indent

" Show the status line all the time
set laststatus=2
" Useful status information at bottom of screen
set statusline=[%n]\ %<%.99f\ %h%w%m%r%y\ %{exists('*CapsLockStatusline')?CapsLockStatusline():''}%=%-16(\ %l,%c-%v\ %)%P

" Always diff using vertical mode
set diffopt+=vertical

" Allows the mouse to be used
set mouse=a

" Automatically reads changed files
set autoread


" Enable syntax highlighting
syntax on
" Sets the colorscheme for terminal sessions too.
colorscheme molokai

" Leader = ,
let mapleader = ","
" }}}
" ##### General mappings  {{{
" ##### Tabs {{{
nnoremap <leader>tn :tabnew<cr>
nnoremap <leader>te :tabedit
nnoremap <leader>tc :tabclose<cr>
nnoremap [t :tabprevious<cr>
nnoremap ]t :tabnext<cr>
" }}}
" ##### Line movement {{{
" Go to start of line with H and to the end with $
function! g:MapLineMovements()
    map H ^
    map L $
endfunction

call g:MapLineMovements()

" Emacs bindings in command-line mode
cnoremap <C-A> <home>
cnoremap <C-E> <end>
" }}}
" ##### Split windows {{{
" Move around easily
nnoremap <C-h> <C-w>h
nnoremap <C-j> <C-w>j
nnoremap <C-k> <C-w>k
nnoremap <C-l> <C-w>l

" Create windows
nnoremap <leader>v <C-w>v<C-w>l
nnoremap <leader>m <C-w>s<C-w>j
nnoremap <leader>d <C-w>q
" }}}
" ##### Folding {{{
" Toggles folding with space
nnoremap <Space> za
vnoremap <Space> zA
" Open all folds
nnoremap zO zR
" Close all folds
nnoremap zC zM
" Close current fold
nnoremap zc zc
" Close all folds except the current one
nnoremap zf mzzMzvzz
" }}}
" ##### Misc {{{
" Edit and load vimrc
nnoremap <leader>ev :vsplit $MYVIMRC<cr>
nnoremap <leader>sv :source $MYVIMRC<cr>

" Wrap current paragraph
noremap <leader>w gqap

" Toggles hlsearch
nnoremap <leader>hs :set hlsearch!<cr>

" Maps <C-C> to <esc>
noremap <C-C> <esc>

" Go full-screen
nnoremap <leader>fs :set lines=999 columns=9999<cr>

" }}}
" }}}
" ##### Plugin settings  {{{
" ##### Fugitive  {{{
" (thanks to Steve Losh's vimrc)
nnoremap <leader>gd :Gdiff<cr>
nnoremap <leader>gs :Gstatus<cr>
nnoremap <leader>gw :Gwrite<cr>
nnoremap <leader>ga :Gadd<cr>
nnoremap <leader>gb :Gblame<cr>
nnoremap <leader>gci :Gcommit<cr>
nnoremap <leader>gm :Gmove
nnoremap <leader>gr :Gread<cr>
nnoremap <leader>grm :Gremove<cr>
nnoremap <leader>gp :Git push
" }}}
" ##### NERDTree  {{{
noremap <leader>ft :NERDTreeToggle<CR>

" Don't fuck up vim's default file browser
let g:NERDTreeHijackNetrw = 0
" }}}
" ##### Airline  {{{
let g:airline_powerline_fonts = 1
let g:airline_theme = 'powerlineish'
let g:airline_section_warning = ''
let g:airline_inactive_collapse = 0
let g:airline#extensions#default#section_truncate_width = {
  \ 'a': 60,
  \ 'b': 80,
  \ 'x': 100,
  \ 'y': 100,
  \ 'z': 60,
\ }
" }}}
" ##### CtrlP  {{{
" Works not only in ancestor directories of my working directory.
let g:ctrlp_working_path_mode = 'a'
" Custom ignores
let g:ctrlp_custom_ignore = 'node_modules\|DS_Store'
" }}}
" ##### Ack  {{{
noremap <C-F> :Ack!<space>
" }}}
" ##### Number toggle  {{{
let g:NumberToggleTrigger="<leader>ll"
"}}}
" ##### togglelist {{{
let g:toggle_list_copen_command="Copen"
" }}}
" ##### Ack motions {{{
" (from Steve Losh's vimrc)
" Motions to Ack for things.  Works with pretty much everything, including:
"
"   w, W, e, E, b, B, t*, f*, i*, a*, and custom text objects
"
" Awesome.
"
" Note: If the text covered by a motion contains a newline it won't work.  Ack
" searches line-by-line.

nnoremap <silent> <leader>a :set opfunc=<SID>AckMotion<CR>g@
xnoremap <silent> <leader>a :<C-U>call <SID>AckMotion(visualmode())<CR>

function! s:CopyMotionForType(type)
    if a:type ==# 'v'
        silent execute "normal! `<" . a:type . "`>y"
    elseif a:type ==# 'char'
        silent execute "normal! `[v`]y"
    endif
endfunction

function! s:AckMotion(type) abort
    let reg_save = @@

    call s:CopyMotionForType(a:type)

    execute "normal! :Ack! --literal " . shellescape(@@) . "\<cr>"

    let @@ = reg_save
endfunction
" }}}
" }}}
" ##### Filetype-specific  {{{
" ##### Ruby  {{{
" Specific shiftwidth for ruby files
autocmd FileType ruby setlocal shiftwidth=2
autocmd FileType ruby setlocal tabstop=2
" Convert tabs to spaces in Ruby files
autocmd FileType ruby setlocal expandtab

" But not for erb files...
autocmd FileType eruby setlocal shiftwidth=4
autocmd FileType eruby setlocal tabstop=4
"
" Remaps textobj-rubyblock's bindings to vim's defaults
autocmd FileType ruby map aB ar
autocmd FileType ruby map iB ir
" }}}
" ##### Puppet  {{{
" Specific shiftwidth for puppet files
autocmd BufRead,BufNewFile *.pp setlocal filetype=puppet
autocmd BufRead,BufNewFile Puppetfile setlocal filetype=ruby

" And custom tab sizes too
autocmd FileType puppet setlocal shiftwidth=2
autocmd FileType puppet setlocal tabstop=2
" }}}
" ##### Markdown  {{{
" Sets markdown syntax for *.md files.
autocmd BufRead,BufNewFile *.md setlocal filetype=markdown

" Wrap markdown files.
autocmd BufRead,BufNewFile *.md setlocal wrap

autocmd BufEnter *.md colorscheme badwolf
" }}}
" ##### JavaScript  {{{
" Sets javascript syntax for *.json files.
autocmd BufRead,BufNewFile *.json setlocal filetype=javascript

" Sets html syntax for *.ejs files.
autocmd BufRead,BufNewFile *.ejs setlocal filetype=html
" }}}
" ##### Vim {{{
" Make vimrcs open folded
autocmd FileType vim setlocal foldlevel=0
autocmd FileType vim setlocal foldmethod=marker
" }}}
" ##### XML {{{
" Automatically format XML files
nnoremap <leader>xb :%s,>[ <tab>]*<,>\r<,g<cr> gg=G
" }}}
" ##### SQL {{{
" SQL to CSV
nnoremap <leader>csv ggV/^+-<cr>dGV?^+-<cr>dgg:g/^+-/d<cr>:%s/^<bar> \<bar> <bar>$//g<cr>:%s/ *<bar> */,/g<cr>
" }}}
" ##### LookML {{{
" Sets YAML syntax for *.lookml files.
autocmd BufRead,BufNewFile *.lookml setlocal filetype=yaml
" }}}
" }}}
" ##### Local Vim Configurations {{{
" Sets YAML syntax for *.lookml files.
nnoremap <leader>elv :vsplit ~/.vimrc.local<cr>
if filereadable(glob("~/.vimrc.local"))
    source ~/.vimrc.local
endif

nnoremap <leader>esv :vsplit ~/.vimrc.secrets<cr>
if filereadable(glob("~/.vimrc.secrets"))
    source ~/.vimrc.secrets
endif

nnoremap <leader>elb :vsplit ~/.vimrc.bundles.local<CR>
" }}}
