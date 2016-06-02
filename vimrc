" OriginalAuthor: Pedro Franceschi <pedrohfranceschi@gmail.com>
" ModifiedVersion: Thales Mello <thalesmello@gmail.com>
" Source: http://github.com/pedrofranceschi/vimfiles

" ##### Plug setup  {{{
set nocompatible

" Install Plug if not already loaded
if empty(glob('~/.vim/autoload/plug.vim'))
  silent !curl -fLo ~/.vim/autoload/plug.vim --create-dirs
    \ https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim
  autocmd VimEnter * PlugInstall | source $MYVIMRC
endif

function! Cond(cond, ...)
  let opts = get(a:000, 0, {})
  return a:cond ? opts : extend(opts, { 'on': [], 'for': [] })
endfunction

call plug#begin()

" "}}}
" ##### Plugins  {{{
Plug 'tpope/vim-sensible'
" Plugin to load tasks asynchronously
Plug 'Shougo/vimproc.vim', { 'do' : 'make' }
" Theme of this vimfiles
Plug 'sjl/badwolf'
" Useful statusbar in your vim
Plug 'bling/vim-airline'
Plug 'vim-airline/vim-airline-themes'
Plug 'b4winckler/vim-objc'
" Comment toggling: use `gc` to toggle comments in visual mode
Plug 'tomtom/tcomment_vim'
" Makes vim understand ruby blocks
Plug 'kana/vim-textobj-user'
Plug 'rhysd/vim-textobj-ruby'
" Git bindings for VIM
Plug 'tpope/vim-fugitive'
" Surround utils for vim
Plug 'tpope/vim-surround'
" Automatic closing of brackets
Plug 'Raimondi/delimitMate'
" Makes vim understand markdown folding
Plug 'nelstrom/vim-markdown-folding'
" Makes the repeat command `.` work in more cases
Plug 'tpope/vim-repeat'
" Vim support for Js handlebars
Plug 'nono/vim-handlebars'
Plug 'nathanaelkane/vim-indent-guides'
" Javascript support for vim
Plug 'jelera/vim-javascript-syntax', { 'for': ['javascript'] }
Plug 'milkypostman/vim-togglelist'
" Relative line number
Plug 'jeffkreeftmeijer/vim-numbertoggle'
" File explorer for VIM. <leader>ft to activate
Plug 'scrooloose/nerdtree'
" Golang support for vim
Plug 'jnwhiteh/vim-golang'
" Make jk behave as jumps in Vim
Plug 'teranex/jk-jumps.vim'
Plug 'tpope/vim-dispatch'
" Expand html easily: div > 3*li then Ctrl+e in an html file
Plug 'rstacruz/sparkup'
" Use the Molokay theme in Vim
Plug 'tomasr/molokai'
" Puppet support for Vim
Plug 'rodjek/vim-puppet'
" Elixir support for Vim
Plug 'elixir-lang/vim-elixir'
" Ruby support for Vim
Plug 'vim-ruby/vim-ruby'
" Automatically recognize indentation
Plug 'thalesmello/vim-sleuth'

" }}}
" ##### Load local Plugins  {{{

" The following loads a local bundles file, in case
" you wish to install local plugins
if filereadable(glob("~/.vimrc.bundles.local"))
    source ~/.vimrc.bundles.local
endif

" }}}
" ##### Finish loading Plug  {{{
call plug#end()

function! PendingPlugInstall()
  if !empty(filter(copy(g:plugs), '!isdirectory(v:val.dir)'))
    PlugInstall

    if has('nvim')
      UpdateRemotePlugins
    endif
  endif
endfunction

autocmd VimEnter * call PendingPlugInstall()

" }}}
" ##### Basic options  {{{
" Display incomplete commands.
set showcmd

" Handle multiple buffers better.
set hidden

" Complete files like a shell.
set wildmode=list:longest,full

" No extra spaces when joining lines
set nojoinspaces

" Case-insensitive searching.
set ignorecase

" Show line numbers.
set number

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

" Useful status information at bottom of screen
set statusline=[%n]\ %<%.99f\ %h%w%m%r%y\ %{exists('*CapsLockStatusline')?CapsLockStatusline():''}%=%-16(\ %l,%c-%v\ %)%P

" Always diff using vertical mode
set diffopt+=vertical

" Allows the mouse to be used
set mouse=a

" Sets the colorscheme for terminal sessions too.
colorscheme molokai

" Leader = ,
let mapleader = "\<space>"
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
nnoremap <leader>d :q<cr>
" }}}
" ##### Folding {{{
" Toggles folding with space
function! MyToggleFold()
  if foldclosed(line('.')) >= 0
    silent! normal zv
  else
    silent! normal za
  endif
endfunction

nnoremap <silent> <s-tab> :<c-U>call MyToggleFold()<cr>
if !has('gui')
  function! JumpForwardOrToggleFold()
    let oldpos = getpos('.')
    execute "normal! 1\<c-i>"
    let newpos = getpos('.')
    if newpos == oldpos
      call MyToggleFold()
    endif
  endf
  nnoremap <silent> <tab> :<c-u>call JumpForwardOrToggleFold()<cr>
endif
" Open all folds
nnoremap <leader>fo zR
" Close all folds
nmap <leader>fc zM
" Close all folds except the current one
nnoremap zf mzzM`zzvzz
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

" nnoremap <silent> <leader>a :set opfunc=<SID>AckMotion<CR>g@
" xnoremap <silent> <leader>a :<C-U>call <SID>AckMotion(visualmode())<CR>
"
" function! s:CopyMotionForType(type)
"     if a:type ==# 'v'
"         silent execute "normal! `<" . a:type . "`>y"
"     elseif a:type ==# 'char'
"         silent execute "normal! `[v`]y"
"     endif
" endfunction
"
" function! s:AckMotion(type) abort
"     let reg_save = @@
"
"     call s:CopyMotionForType(a:type)
"
"     execute "normal! :Ack! --literal " . shellescape(@@) . "\<cr>"
"
"     let @@ = reg_save
" endfunction
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
" ##### LookML {{{
" Sets YAML syntax for *.lookml files.
autocmd BufRead,BufNewFile *.lookml setlocal filetype=yaml
" }}}
" ##### Reload Vim Sleuth {{{
augroup sleuth
  autocmd!
  autocmd FileType * VimSleuthReload
augroup END
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
" }}}"
