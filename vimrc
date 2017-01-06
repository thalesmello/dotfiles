"/ OriginalAuthor: Pedro Franceschi <pedrohfranceschi@gmail.com>
" ModifiedVersion: Thales Mello <thalesmello@gmail.com>
" Source: http://github.com/thalesmello/vimfiles

" ##### Plug setup  {{{
set nocompatible
call plug#begin()

" "}}}
" ##### Plugins  {{{
Plug 'tpope/vim-sensible'
Plug 'morhetz/gruvbox'
Plug 'thalesmello/tabfold'
Plug 'tomtom/tcomment_vim'
Plug 'Shougo/vimproc.vim', { 'do' : 'make' }
Plug 'itchyny/lightline.vim'
Plug 'tpope/vim-fugitive'
Plug 'tpope/vim-surround'
Plug 'Raimondi/delimitMate'
Plug 'nelstrom/vim-markdown-folding'
Plug 'tpope/vim-repeat'
Plug 'tpope/vim-abolish'
Plug 'tweekmonster/local-indent.vim'
Plug 'scrooloose/nerdtree', { 'on': ['NERDTreeToggle', 'NERDTreeFind'] }
Plug 'teranex/jk-jumps.vim'
Plug 'rstacruz/sparkup'
Plug 'thalesmello/vim-sleuth'
Plug 'terryma/vim-multiple-cursors'
Plug 'christoomey/vim-tmux-navigator'
Plug 'airblade/vim-gitgutter'
Plug 'sheerun/vim-polyglot'
Plug 'tpope/vim-endwise'
Plug 'ludovicchabant/vim-gutentags', only#if(v:version >= 704)
Plug 'easymotion/vim-easymotion'
Plug 'tpope/vim-rsi'
Plug 'thalesmello/tmux-complete.vim'
Plug 'bronson/vim-visual-star-search'
Plug 'bronson/vim-trailing-whitespace'
Plug 'thalesmello/vim-indent-object'
Plug 'thalesmello/vimux'
Plug 'embear/vim-localvimrc'
Plug 'thalesmello/vim-unimpaired'
Plug 'Chiel92/vim-autoformat'
Plug 'neomake/neomake'
Plug 'simnalamburt/vim-mundo'
Plug 'simeji/winresizer'
Plug 'godlygeek/tabular'
Plug 'wesQ3/vim-windowswap'
Plug 'SirVer/ultisnips', only#if(v:version >= 704, { 'on': ['UltiSnipsEdit'] })
Plug 'honza/vim-snippets'
Plug 'ryanoasis/vim-devicons'
Plug 'AndrewRadev/splitjoin.vim'
Plug 'gioele/vim-autoswap'
Plug 'junegunn/fzf' | Plug 'junegunn/fzf.vim'
Plug 'tpope/vim-speeddating'
Plug 'vimwiki/vimwiki'
Plug 'itchyny/vim-cursorword'
Plug 'wincent/terminus'
Plug 'davidhalter/jedi'
Plug 'dbakker/vim-projectroot'
Plug 'thalesmello/pulsecursor.vim'
Plug 'thalesmello/tabmessage.vim'
Plug 'thalesmello/persistent.vim'
Plug 'thalesmello/pagarme-refactor.vim'
Plug 'thalesmello/config.loupe' | Plug 'wincent/loupe'
Plug 'dietsche/vim-lastplace'
Plug 'EinfachToll/DidYouMean'
Plug 'duggiefresh/vim-easydir'
Plug 'tmux-plugins/vim-tmux'
Plug 'zeorin/tmuxline.vim', {'branch': 'utf8-suppress-error'}
Plug 'thalesmello/devlindo.vim'
Plug 'sealemar/vtl'
Plug 'machakann/vim-highlightedyank'
Plug 'vim-scripts/ingo-library'
Plug 'vim-scripts/SyntaxRange'
Plug 'jalvesaq/Nvim-R'
Plug 'bfredl/nvim-miniyank', only#if(has('nvim'))
Plug 'alcesleo/vim-uppercase-sql'
Plug 'moll/vim-node'

" Unite
Plug 'Shougo/unite.vim'
Plug 'thalesmello/config.neoyank.vim' | Plug 'Shougo/neoyank.vim', { 'on': [] }
Plug 'Shougo/unite-help'
Plug 'thinca/vim-unite-history'
Plug 'thalesmello/unite-cmdmatch'
Plug 'Shougo/unite-outline'
Plug 'osyo-manga/unite-quickfix'
Plug 'thalesmello/config-unite-outline'

" Deoplete
Plug 'Shougo/deoplete.nvim',            only#if(has('nvim'))
" Plug 'thalesmello/webcomplete.vim',     only#if(has('nvim'))
Plug 'zchee/deoplete-jedi',             only#if(has('nvim'), {'for': 'python'})
Plug 'mhartington/deoplete-typescript', only#if(has('nvim'), {'for': 'javascript'})

" Text objects
Plug 'kana/vim-textobj-user'
Plug 'rhysd/vim-textobj-ruby'
Plug 'kana/vim-textobj-function'
Plug 'bps/vim-textobj-python'
Plug 'glts/vim-textobj-comment'
Plug 'kana/vim-textobj-line'
Plug 'Julian/vim-textobj-variable-segment'
Plug 'kana/vim-textobj-entire'
Plug 'thinca/vim-textobj-function-javascript'
Plug 'coderifous/textobj-word-column.vim'
Plug 'sgur/vim-textobj-parameter'
Plug 'saihoooooooo/vim-textobj-space'
Plug 'glts/vim-textobj-indblock'
Plug 'kana/vim-textobj-indent'
Plug 'rhysd/vim-textobj-lastinserted'
Plug 'kana/vim-textobj-fold'
Plug 'thalesmello/vim-textobj-methodcall'
Plug 'thalesmello/vim-textobj-bracketchunk'
Plug 'rhysd/vim-textobj-conflict'

" New
Plug 'ivalkeen/vim-simpledb'
Plug 'fatih/vim-go'
Plug 'zchee/deoplete-go'
Plug 'Shougo/neco-vim'

" TODO: Check
" github-complete.vim
" committia.vim
" make outline use ctags for JavaScript

" }}}
" ##### Finish loading Plug  {{{
call plug#end()

call auto#defer('plug_utils#pending_install()')

" }}}
" ##### Basic options  {{{
" Display incomplete commands.
set showcmd

set shortmess+=I

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
set relativenumber

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

" Always diff using vertical mode
set diffopt+=vertical

" Allows the mouse to be used
set mouse=a

" Copy to system register
set clipboard=unnamed

" Set virtual edit
set virtualedit=block,onemore

" Sets the colorscheme for terminal sessions too.
set background=dark
colorscheme gruvbox

let maplocalleader = "'"
set cursorline
set listchars=tab:▸\ ,eol:¬
set splitbelow
set linebreak
set noshowmode
set updatetime=500
set sidescroll=2
set showbreak=↪
set tabstop=4

if has('nvim')
  set termguicolors
  let $NVIM_TUI_ENABLE_CURSOR_SHAPE = 1
endif

let mapleader = "\<space>"

if exists('&inccommand')
  set inccommand=split
endif
" }}}
" ##### Mappings  {{{
nnoremap <silent> <leader>tn :execute  "tabedit % \| call setpos('.', " . string(getpos('.')) . ")"<cr>
nnoremap <leader>tc :tabclose<cr>
nnoremap [t :tabprevious<cr>
nnoremap ]t :tabnext<cr>

" Create windows
nnoremap <leader>v <C-w>v<C-w>l
nnoremap <leader>m <C-w>s<C-w>j
nnoremap <leader>d :q<cr>
nnoremap zf mzzM`zzvzz

" Files open expanded
" Use decent folding
if has('vim_starting')
  set foldlevelstart=50
  set foldmethod=indent
endif

" Edit and load vimrc
nnoremap <leader>ev :vsplit $MYVIMRC<cr>
nnoremap <leader>sv :source $MYVIMRC<cr>

" Toggles hlsearch
nnoremap <leader>hs :set hlsearch!<cr>

" Maps <C-C> to <esc>
inoremap <C-C> <esc>
vnoremap <C-C> <esc>
map <MiddleMouse> <Nop>
imap <MiddleMouse> <Nop>
noremap Q gq
nnoremap K <nop>
nnoremap & <Nop>
vnoremap <CR> "+y
" The snippet below tries to intelligently split a string and append a concat
" operator in it
nnoremap <leader><cr> mz?\v(".*"\|'.*')<cr>"qyl`zi<c-r>q +<cr><c-r>q<esc>
nnoremap <leader>yy gv"+y
vnoremap <leader>yy "+y
vnoremap @ :normal @
vnoremap <c-c> "+y
nnoremap <leader><leader><leader> <c-^>
nnoremap <leader>o `>
nnoremap <leader>] `]
nnoremap <leader>ss :w<cr>
nnoremap <leader>saa ggVG
nnoremap <leader>saq ?\v('''\|""")<CR>vw//e<CR>
nnoremap <leader>siq ?\v('''\|""")<CR>wv//e<CR>ge
nnoremap <leader>sl $v^
nmap <leader>* *N
vmap <leader>* *N
vmap <leader>c* *Ncgn
nmap c* *Ncgn
nnoremap Y y$
nnoremap <leader>fw :FixWhitespace<cr>
vmap <leader>yj Jgvyu
noremap <c-e> 2<c-e>
noremap <c-y> 2<c-y>
nnoremap <leader>; A;<esc>
nnoremap <leader><bs> $x<esc>
nnoremap <leader>= <c-w>=
nnoremap <leader>+ <c-w>\|<c-w>_
nnoremap <leader>\| <c-w>\|
nnoremap <leader>cd :lcd %:p:h<cr>
nnoremap <leader>cr :ProjectRootCD<cr>
nnoremap <S-ScrollWheelUp>   <ScrollWheelLeft>
nnoremap <S-2-ScrollWheelUp> <2-ScrollWheelLeft>
nnoremap <S-3-ScrollWheelUp> <3-ScrollWheelLeft>
nnoremap <S-4-ScrollWheelUp> <4-ScrollWheelLeft>
nnoremap <S-ScrollWheelDown>     <ScrollWheelRight>
nnoremap <S-2-ScrollWheelDown>   <2-ScrollWheelRight>
nnoremap <S-3-ScrollWheelDown>   <3-ScrollWheelRight>
nnoremap <S-4-ScrollWheelDown>   <4-ScrollWheelRight>
nnoremap <leader>sf :source %<cr>
vnoremap _ <esc>`<jV`>k0
vnoremap - <esc>`<jV`>k0
vnoremap + <esc>`<kV`>j0
nnoremap <leader>V vg_
nnoremap  gs  :%s//g<LEFT><LEFT>
vnoremap  gs  :s//g<LEFT><LEFT>

" # Vim Multiple Cursors  {{{
" Lazyloadable if I disable default mappings
let g:multi_cursor_exit_from_insert_mode = 0
let g:multi_cursor_exit_from_visual_mode = 0
let g:deoplete#auto_complete_delay = 100

function! Multiple_cursors_before()
  call deoplete_config#multiple_cursors_switch(1)
endfunction

function! Multiple_cursors_after()
  call deoplete_config#multiple_cursors_switch(0)
endfunction

noremap g<c-n> :MultipleCursorsFind <c-r>/<cr>

highlight multiple_cursors_cursor term=reverse cterm=reverse gui=reverse
highlight link multiple_cursors_visual Visual

" "}}}
" # Easymotion  {{{
" Lazy loadable
let g:EasyMotion_smartcase = 1

map <leader><leader> <Plug>(easymotion-prefix)
nmap f <Plug>(easymotion-bd-f)
xmap f <Plug>(easymotion-bd-f)
omap f <Plug>(easymotion-bd-f)
nmap F <Plug>(easymotion-overwin-f2)
xmap F <Plug>(easymotion-overwin-f2)
omap F <Plug>(easymotion-overwin-f2)

" "}}}
" # Vim Tmux Navigator  {{{
" Lazy loadable
let g:tmux_navigator_no_mappings = 1
nnoremap <silent> <C-H> :TmuxNavigateLeft<cr>
nnoremap <silent> <C-J> :TmuxNavigateDown<cr>
nnoremap <silent> <C-K> :TmuxNavigateUp<cr>
nnoremap <silent> <C-L> :TmuxNavigateRight<cr>

" "}}}
" # Pipe visual to shell {{{
command! -range VisualCommand <line1>,<line2>call vim_utils#visual_command()
vnoremap <leader>\| :VisualCommand<CR>

" }}} "
" # Lightline  {{{
call lightline_config#load()

" "}}}
" # Tmuxline  {{{
" Plugin extractable configuration?
let g:airline#extensions#tmuxline#enabled = 0
let s:computer_emoji = '💻'
let g:tmuxline_preset = {
      \'a'       : [s:computer_emoji . '  #(whoami)', '#S'],
      \'win'     : ['#I', '#W'],
      \'cwin'    : ['#I', '#W'],
      \'x'       : ['#{prefix_highlight}'],
      \'z'       : ['On: #{online_status}', '#{battery_icon} #{battery_percentage}', '%R'],
      \'options' : {'status-justify' : 'left'}}

" "}}}
" # Gutentags  {{{
let g:gutentags_exclude = ['node_modules', '.git']

" "}}}
" # Deoplete  {{{
" Plugin extractable
let g:deoplete#omni#input_patterns = {}
let g:deoplete#omni#input_patterns.ruby = ['[^. *\t]\.\w*', '[a-zA-Z_]\w*::']
let g:deoplete#omni#input_patterns.vimwiki = '\[\[.*'

let g:deoplete#enable_at_startup = 1
let g:deoplete#file#enable_buffer_path = 1

call auto#cmd('preview_window', 'InsertLeave * if empty(&buftype) | pclose! | endif')

inoremap <silent> <up> <c-r>=deoplete_config#arrow_navigation('Up')<CR>
inoremap <silent> <Down> <c-r>=deoplete_config#arrow_navigation('Down')<CR>
inoremap <expr><C-l> deoplete#refresh()

" "}}}
" # UltiSnips  {{{
" Create command to load ultisnips and call it on vimenter
" Plugin extractable configuration
call auto#defer("plug#load('ultisnips')")

let g:ulti_expand_res = 0
let g:ulti_jump_forwards_res = 0
let g:UltiSnipsEditSplit           = "vertical"
xnoremap <silent> <tab> :call UltiSnips#SaveLastVisualSelection()<CR>gvs
inoremap <silent> <c-l> <c-r>=ultisnips_config#jump_or_expand_snippet()<cr>
imap <silent> <Tab> <c-r>=ultisnips_config#expand_snippet()<cr>
let g:UltiSnipsExpandTrigger       = "<c-x><c-x><tab>"
let g:UltiSnipsJumpBackwardTrigger = "<c-h>"
let g:UltiSnipsJumpForwardTrigger  = "<c-l>"
let g:UltiSnipsSnippetsDir         = '~/.snips'
let g:UltiSnipsSnippetDirectories  = ["UltiSnips", $HOME . "/.snips"]
imap <c-j> <nop>
inoremap <c-x><c-k> <c-x><c-k>
nmap <leader>esp :UltiSnipsEdit<cr>

call auto#cmd('set_snippets_filetype', 'BufRead *.snippets setlocal filetype=snippets')

" "}}}
" # NerdTREE  {{{
noremap <silent> <leader>nt :NERDTreeToggle<CR>
let g:NERDTreeHijackNetrw = 0
let g:NERDTreeIgnore = ['\.pyc$']
nnoremap <silent> <leader>nf :NERDTreeFind<cr>
let g:NERDTreeQuitOnOpen = 1

" "}}}
" # Ruby  {{{
let g:rubycomplete_buffer_loading = 1
let g:rubycomplete_classes_in_global = 1
let g:rubycomplete_use_bundler = 1
let g:rubycomplete_load_gemfile = 1

" "}}}
" # Vimux  {{{
" Plugins extractable configuration
" Prompt for a command to run
map <silent> <localleader>vp :VimuxPromptCommand<CR>
map <silent> <localleader>vl :call VimuxSendKeys('up Enter')<CR>
map <silent> <localleader>vi :VimuxInspectRunner<CR>
map <silent> <localleader>vq :VimuxCloseRunner<CR>
map <silent> <localleader>vx :VimuxInterruptRunner<CR>
map <silent> <localleader>vz :call VimuxZoomRunner()<CR>
map <silent> <localleader>vo :call VimuxOpenRunner()<CR>

" If text is selected, save it in the v buffer and send that buffer it to tmux
vmap <silent> <localleader>vs :call vimux_config#slime()<CR>`>j^
vmap <silent> <localleader>vj Jgv:call vimux_config#slime()<CR>u`>j^
vmap <silent> <localleader>vyp Jgv:call vimux_config#copy_postgres()<CR>u`>j^
vmap <silent> <localleader>v; Jgv:call vimux_config#slime_semicolon()<CR>u`>j^
vmap <silent> <localleader><CR> <localleader>vs

" Select current paragraph and send it to tmux
nmap <silent> <localleader>vs vip<localleader>vs
nmap <silent> <localleader>vj vip<localleader>vj
nmap <silent> <localleader>vyp vip<localleader>vyp
nmap <silent> <localleader>v; vip<localleader>v;
nmap <silent> <localleader><CR> V<localleader>vs
nmap <silent> <localleader>vaa ggVG<localleader>vs
nmap <silent> <localleader>vaj ggVG<localleader>vj

" Execute current file in the interpreter
nnoremap <silent> <localleader>vf :w<CR>:call VimuxRunCommand(vimux_config#get_execute_command())<CR>
nnoremap <silent> <localleader>vw :call VimuxRunCommand(vimux_config#get_nodemon_command())<CR>
nmap <silent> <localleader>vr <localleader>vq:call VimuxRunCommand(vimux_config#get_repl_command())<CR>
nnoremap <silent> <localleader>vtp :call vimux_config#run_pagarme_test()<cr>

" Python specific shortcuts
augroup python_vimux_shortuts
  autocmd!
  autocmd FileType python vmap <buffer> <localleader>vs :call VimuxSlimeLineBreak()<CR>`>j^
  autocmd FileType python nmap <localleader><CR> V:call vimux_config#slime()<CR>`>j^
augroup END

" "}}}
" # Localvimrc  {{{
let g:localvimrc_persistent = 1
let g:avoid_standard_js_autowriter = 1
let g:localvimrc_event = ['VimEnter']

" "}}}
" # Autoformat  {{{
" Lazy configurable
noremap <leader>sb :Autoformat<cr>
let g:formatdef_sqlformat = '"sqlformat -k upper -r --indent_width=4 -"'
let g:formatdef_rubocop = '"rubocop --auto-correct " . expand("%") . " -o /dev/null || cat " . expand("%")'
let g:formatdef_standardjs = '"standard-format -"'
let g:formatters_sql = ['sqlformat']
let g:formatters_ruby = ['rubocop']

" "}}}
" # Mundo  {{{
" Lazy configurable
nnoremap <leader>gu :MundoToggle<CR>

" "}}}
" # Winresizer  {{{
" Plugin extractable configuration
let g:winresizer_start_key = '<leader>wr'
let g:winresizer_keycode_left = 72
let g:winresizer_keycode_right = 76
let g:winresizer_keycode_down = 74
let g:winresizer_keycode_up = 75
nmap <leader>H <leader>wrH
nmap <leader>J <leader>wrJ
nmap <leader>K <leader>wrK
nmap <leader>L <leader>wrL

" "}}}
" # Tabularize  {{{
noremap <leader>ta :Tabularize /
noremap <leader>t/ :Tabularize /<c-r>//l1l0l0<cr>

" "}}}
" # Vim Gitgutter  {{{
omap ih <Plug>GitGutterTextObjectInnerPending
omap ah <Plug>GitGutterTextObjectOuterPending
xmap ih <Plug>GitGutterTextObjectInnerVisual
xmap ah <Plug>GitGutterTextObjectOuterVisual

" "}}}
" # Textobj User  {{{
" Plugin extractable configuration? study possibility
call textobj#user#map('python', { 'class': { 'select-a': 'aP', 'select-i': 'iP', } })
let g:textobj_python_no_default_key_mappings = 1

call textobj#user#map('indent', { '-': { 'select-a': 'ai', 'select-i': 'ii' } })
let g:textobj_indent_no_default_key_mappings = 1

" "}}}
" # Textobj column  {{{
" Plugin extractable configuration
let g:skip_default_textobj_word_column_mappings = 1
xnoremap <silent> ak :<C-u>call TextObjWordBasedColumn("aw")<cr>
xnoremap <silent> aK :<C-u>call TextObjWordBasedColumn("aW")<cr>
xnoremap <silent> ik :<C-u>call TextObjWordBasedColumn("iw")<cr>
xnoremap <silent> iK :<C-u>call TextObjWordBasedColumn("iW")<cr>
onoremap <silent> ak :call TextObjWordBasedColumn("aw")<cr>
onoremap <silent> aK :call TextObjWordBasedColumn("aW")<cr>
onoremap <silent> ik :call TextObjWordBasedColumn("iw")<cr>
onoremap <silent> iK :call TextObjWordBasedColumn("iW")<cr>

" "}}}
" # Tcommenter  {{{
let g:tcommentTextObjectInlineComment = ''

" "}}}
" # FZF  {{{
nnoremap <c-p> :<c-u>FZF<CR>
vnoremap <c-p> :<c-u>FZF<CR>

let g:fzf_history_dir = '~/.local/share/fzf-history'

nnoremap <c-f> :Ag<space>

nnoremap <silent> <leader>a :<c-u>Ag <c-r><c-w><cr>
vnoremap <silent> <leader>a :<c-u>call fzf_config#visual_ag()<cr>
nnoremap <silent> <leader>li :BLines<cr>
nnoremap <silent> <leader>hp :Helptags<cr>
nnoremap <silent> <leader>cm :Commands<cr>
nnoremap <silent> <leader>hi :History:<cr>
nnoremap <silent> <leader>ft :Filetypes<cr>

" "}}}
" # Unite.vim {{{
" "}}}
" " }}}
" # Neovim terminal  {{{
if has('nvim')
  tnoremap <silent> <C-h> <C-\><C-n>:TmuxNavigateLeft<cr>
  tnoremap <silent> <C-j> <C-\><C-n>:TmuxNavigateDown<cr>
  tnoremap <silent> <C-k> <C-\><C-n>:TmuxNavigateUp<cr>
  tnoremap <silent> <C-l> <C-\><C-n>:TmuxNavigateRight<cr>
  tnoremap <silent> <c-]><esc> <C-\><C-n>
  autocmd BufWinEnter,WinEnter term://* startinsert
  autocmd BufLeave term://* stopinsert
endif
" "}}}
" Lookml {{{ "
call auto#cmd('lookml', 'BufRead *.lookml setfiletype yaml')

" }}} Lookml "
" Defer mechanism {{{ "
call auto#setup_defer()

" }}} Defer mechanism "
