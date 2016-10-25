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
" Useful statusbar in your vim
Plug 'vim-airline/vim-airline'
" Comment toggling: use `gc` to toggle comments in visual mode
Plug 'tomtom/tcomment_vim'
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
" Local indent in a file
Plug 'tweekmonster/local-indent.vim'
" Relative line number
Plug 'jeffkreeftmeijer/vim-numbertoggle'
" File explorer for VIM. <leader>nt to activate
Plug 'scrooloose/nerdtree', { 'on': ['NERDTreeToggle', 'NERDTreeFind'] }
" Make jk behave as jumps in Vim
Plug 'teranex/jk-jumps.vim'
" Expand html easily: div > 3*li then Ctrl+e in an html file
Plug 'rstacruz/sparkup'
" Automatically recognize indentation
Plug 'thalesmello/vim-sleuth'

Plug 'morhetz/gruvbox'

Plug 'terryma/vim-multiple-cursors'
Plug 'thalesmello/vim-tmux-navigator'
" Plug 'airblade/vim-gitgutter'
Plug 'sheerun/vim-polyglot'
Plug 'tpope/vim-endwise'
" Plug 'c0r73x/neotags.nvim', Cond(has('nvim'))
Plug 'easymotion/vim-easymotion'
Plug 'szw/vim-g'
Plug 'tpope/vim-rsi'
Plug 'wellle/tmux-complete.vim'
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
Plug 'thalesmello/lazy.ultisnips' | Plug 'SirVer/ultisnips', Cond(v:version >= 704, { 'on': ['UltiSnipsEdit'] })
Plug 'honza/vim-snippets'
Plug 'ryanoasis/vim-devicons'
Plug 'kana/vim-textobj-user'
      \ | Plug 'rhysd/vim-textobj-ruby'
      \ | Plug 'kana/vim-textobj-function'
      \ | Plug 'bps/vim-textobj-python'
      \ | Plug 'glts/vim-textobj-comment'
      \ | Plug 'kana/vim-textobj-line'
      \ | Plug 'Julian/vim-textobj-variable-segment'
      \ | Plug 'kana/vim-textobj-entire'
      \ | Plug 'thinca/vim-textobj-function-javascript'
      \ | Plug 'coderifous/textobj-word-column.vim'
      \ | Plug 'sgur/vim-textobj-parameter'
      \ | Plug 'saihoooooooo/vim-textobj-space'
      \ | Plug 'glts/vim-textobj-indblock'
      \ | Plug 'kana/vim-textobj-indent'
      \ | Plug 'rhysd/vim-textobj-lastinserted'
      \ | Plug 'kana/vim-textobj-fold'
      \ | Plug 'thalesmello/vim-textobj-methodcall'
      \ | Plug 'thalesmello/vim-textobj-bracketchunk'
      \ | Plug 'rhysd/vim-textobj-conflict'
Plug 'AndrewRadev/splitjoin.vim'
Plug 'Shougo/unite.vim'
      \ | Plug 'thalesmello/config.neoyank.vim' | Plug 'Shougo/neoyank.vim'
      \ | Plug 'Shougo/unite-help'
      \ | Plug 'thinca/vim-unite-history'
      \ | Plug 'thalesmello/unite-cmdmatch'
      \ | Plug 'Shougo/unite-outline'
      \ | Plug 'osyo-manga/unite-quickfix'
      \ | Plug 'Shougo/neomru.vim'
      \ | Plug 'thalesmello/config-unite-outline'
Plug 'gioele/vim-autoswap'
Plug 'junegunn/fzf' | Plug 'junegunn/fzf.vim'
Plug 'tpope/vim-speeddating'
Plug 'vimwiki/vimwiki'
Plug 'itchyny/vim-cursorword'
Plug 'osyo-manga/vim-over'
Plug 'wincent/terminus'
Plug 'haya14busa/incsearch.vim'
Plug 'davidhalter/jedi'
Plug 'dbakker/vim-projectroot'
Plug 'Shougo/deoplete.nvim',                      Cond(has('nvim'))
      \ | Plug 'zchee/deoplete-jedi',             Cond(has('nvim'))
      \ | Plug 'mhartington/deoplete-typescript', Cond(has('nvim'))
      \ | Plug 'Shougo/echodoc.vim',              Cond(has('nvim'))
      \ | Plug 'thalesmello/webcomplete.vim',     Cond(has('nvim'))
Plug 'thalesmello/pulsecursor.vim'
Plug 'thalesmello/tabmessage.vim'
Plug 'thalesmello/persistent.vim'
Plug 'thalesmello/pagarme-refactor.vim'
Plug 'thalesmello/config.loupe' | Plug 'wincent/loupe'
Plug 'dietsche/vim-lastplace'
Plug 'EinfachToll/DidYouMean'
Plug 'duggiefresh/vim-easydir'
Plug 'Konfekt/FastFold'
Plug 'tmux-plugins/vim-tmux'
Plug 'zeorin/tmuxline.vim', {'branch': 'utf8-suppress-error'}
Plug 'thalesmello/devlindo.vim'
Plug 'sealemar/vtl'
Plug 'machakann/vim-highlightedyank'
Plug 'vim-scripts/ingo-library'
Plug 'vim-scripts/SyntaxRange'
Plug 'jalvesaq/Nvim-R'
" Plug 'othree/jspc.vim'
Plug 'bfredl/nvim-miniyank', Cond(has('nvim'))

" TODO: Check
" github-complete.vim
" committia.vim
" make outline use ctags for JavaScript

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
let g:gruvbox_contrast_dark = 'hard'
colorscheme gruvbox

let maplocalleader = "'"
set cursorline
set listchars=tab:▸\ ,eol:¬
set completeopt-=preview
set linebreak
set noshowmode
set updatetime=500
set sidescroll=2
set showbreak=↪

if has('nvim')
  set termguicolors
  let $NVIM_TUI_ENABLE_CURSOR_SHAPE = 1
endif

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
" Emacs like line mappings {{{ "
cnoremap <C-A> <home>
cnoremap <C-E> <end>
" }}}
" ##### Split windows {{{

" Create windows
nnoremap <leader>v <C-w>v<C-w>l
nnoremap <leader>m <C-w>s<C-w>j
nnoremap <leader>d :q<cr>
" }}}
" ##### Folding {{{
" Toggles folding with space
" Plugin extractable
function! MyToggleFold()
  if foldclosed(line('.')) >= 0
    silent! normal zv
  else
    silent! normal za
  endif
endfunction

nnoremap <silent> <s-tab> :<c-U>call MyToggleFold()<cr>
nnoremap <silent> <leader><tab> :<c-U>call MyToggleFold()<cr>
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
" Close all folds except the current one
nnoremap zf mzzM`zzvzz

" Files open expanded
" Use decent folding
set foldlevelstart=50
augroup set_fold_method
  autocmd!
  autocmd FileType * setlocal foldmethod=indent
  autocmd FileType vim setlocal foldlevel=0
  autocmd FileType vim setlocal foldmethod=marker
  autocmd FileType markdown setlocal foldmethod=expr
  autocmd FileType snippets setlocal foldmethod=marker
  autocmd FileType javascript set foldmethod=syntax
  autocmd FileType javascript setlocal foldlevelstart=50
augroup end

" }}}
" ##### Misc {{{
" Edit and load vimrc
nnoremap <leader>ev :vsplit $MYVIMRC<cr>
nnoremap <leader>sv :source $MYVIMRC<cr>

" Toggles hlsearch
nnoremap <leader>hs :set hlsearch!<cr>

" Maps <C-C> to <esc>
inoremap <C-C> <esc>
vnoremap <C-C> <esc>

" }}}
" }}}
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
" ##### Number toggle  {{{
let g:NumberToggleTrigger="<leader>ll"
"}}}
" ##### Vim Sleuth {{{
augroup sleuth
  autocmd!
  autocmd FileType * VimSleuthReload
augroup END
" }}}
" # Mappings  {{{
map <MiddleMouse> <Nop>
imap <MiddleMouse> <Nop>
noremap Q gq
nnoremap K <nop>
nnoremap & <Nop>
vnoremap <CR> "+y
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
nmap <leader>tn :tabnew<cr>
vmap <leader>tn y:tabnew<cr>p
nmap <leader>bn :vnew<cr>
vmap <leader>bn y:vnew<cr>p
nmap <leader>bc :bw<cr>
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

" "}}}
" # Vim over  {{{
" Lazy loadable
nnoremap  gs  :OverCommandLine<cr>%s//g<LEFT><LEFT>
vnoremap  gs  :OverCommandLine<cr>s//g<LEFT><LEFT>
nnoremap  <leader>: :OverCommandLine<cr>
let g:over_enable_auto_nohlsearch = 0

" "}}}
" # Vim Multiple Cursors  {{{
" Lazyloadable if I disable default mappings
let g:multi_cursor_exit_from_insert_mode = 0
let g:multi_cursor_exit_from_visual_mode = 0
let g:deoplete#auto_complete_delay = 100

function! Multiple_cursors_before()
  call DeopleteMultipleCursorsSwitch(1)
endfunction

function! Multiple_cursors_after()
  call DeopleteMultipleCursorsSwitch(0)
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
" Plugin extractable
" By Xolox @ http://stackoverflow.com/questions/1533565/how-to-get-visually-selected-text-in-vimscript
function! s:get_visual_selection()
  let [lnum1, col1] = getpos("'<")[1:2]
  let [lnum2, col2] = getpos("'>")[1:2]
  let lines = getline(lnum1, lnum2)
  let lines[-1] = lines[-1][: col2 - (&selection == 'inclusive' ? 1 : 2)]
  let lines[0] = lines[0][col1 - 1:]
  return join(lines, "\n")
endfunction

function! s:Chomp(string)
  return substitute(a:string, '\n\+$', '', '')
endfunction

function! s:visual_command() range
  let text = s:get_visual_selection()
  let cmd = input('Pipe: ', '', 'shellcmd')
  let @v = s:Chomp(system(cmd, text))
  execute 'normal! gv"vp'
endfunction

command! -range VisualCommand <line1>,<line2>call s:visual_command()
vnoremap <leader>\| :VisualCommand<CR>

" }}} "
" # Airline  {{{
" Plugin extractable configuration?
let g:airline_powerline_fonts = 1
let g:airline_theme = 'gruvbox'
let g:airline_inactive_collapse = 1
let g:airline#extensions#branch#displayed_head_limit = 15
let g:airline#extensions#default#section_truncate_width = {}
let g:airline#extensions#tabline#show_buffers = 0
let g:airline#extensions#tabline#enabled = 1

let g:unite_outline_closest_tag = ""
function! AirlineInit()
  let g:airline_section_a = airline#section#create(['mode'])
  let g:airline_section_b = airline#section#create(['file', ' ', 'readonly'])
  let g:airline_section_c = airline#section#create(['%{g:unite_outline_closest_tag}'])
  let g:airline_section_x = airline#section#create([])
  let g:airline_section_y = airline#section#create(['%<', 'branch'])
  let g:airline_section_z = airline#section#create(['%p%% ', '%{g:airline_symbols.linenr}%#__accent_bold#%l%#__restore__#:%v'])
endfunction
autocmd User AirlineAfterInit call AirlineInit()

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
" # Deoplete  {{{
" Plugin extractable
let g:deoplete#omni#input_patterns = {}
let g:deoplete#omni#input_patterns.ruby = ['[^. *\t]\.\w*', '[a-zA-Z_]\w*::']
let g:deoplete#omni#input_patterns.javascript = "(\\.|\'|\")"
let g:deoplete#omni#input_patterns.vimwiki = '\[\[.*'

" let g:deoplete#omni#functions = {}
" let g:deoplete#omni#functions.javascript = [ 'jspc#omni', 'javascriptcomplete#CompleteJS' ]

function! DeopleteMultipleCursorsSwitch(before)
  if !exists('g:loaded_deoplete')
    return
  endif
  if a:before
    let s:old_disable_deoplete = g:deoplete#disable_auto_complete
    let g:deoplete#disable_auto_complete = 1
  else
    let g:deoplete#disable_auto_complete = s:old_disable_deoplete
  endif
endfunction

let g:deoplete#enable_at_startup = 1
let g:echodoc_enable_at_startup = 1

function! ToggleEchoDocFunc()
  if echodoc#is_enabled()
    call echodoc#disable()
  else
    call echodoc#enable()
  endif
endfunction

command! EchoDocToggle call ToggleEchoDocFunc()
nnoremap <leader>ed :<c-u>EchoDocToggle<cr>

inoremap <up> <c-p>
inoremap <down> <c-n>
inoremap <expr><C-l> deoplete#refresh()

" "}}}
" # UltiSnips  {{{
" Create command to load ultisnips and call it on vimenter
" Plugin extractable configuration
let g:ulti_expand_res = 0
let g:ulti_jump_forwards_res = 0
function! JumpOrExpandSnippet()
  call UltiSnips#JumpForwards()
  if !g:ulti_jump_forwards_res
    call UltiSnips#ExpandSnippet()
  endif
  return ''
endfunction

function! MyExpandSnippet()
  call UltiSnips#ExpandSnippet()

  if g:ulti_expand_res
    return ""
  elseif pumvisible()
    return "\<c-n>"
  else
    return "\<tab>"
  end
endf

let g:UltiSnipsEditSplit           = "vertical"
xnoremap <silent> <tab> :call UltiSnips#SaveLastVisualSelection()<CR>gvs
inoremap <silent> <c-l> <c-r>=JumpOrExpandSnippet()<cr>
imap <silent> <Tab> <c-r>=MyExpandSnippet()<cr>
let g:UltiSnipsExpandTrigger       = "<c-x><c-x><tab>"
let g:UltiSnipsJumpBackwardTrigger = "<c-h>"
let g:UltiSnipsJumpForwardTrigger  = "<c-l>"
let g:UltiSnipsSnippetsDir         = '~/.snips'
let g:UltiSnipsSnippetDirectories  = ["UltiSnips", $HOME . "/.snips"]
imap <c-j> <nop>
inoremap <c-x><c-k> <c-x><c-k>
nmap <leader>esp :UltiSnipsEdit<cr>

augroup set_snippets_filetype_correctly
  " this one is which you're most likely to use?
  autocmd BufRead *.snippets setlocal filetype=snippets
  autocmd FileType snippets setlocal foldmarker=<<<,>>>
augroup end

" "}}}
" # NerdTREE  {{{
noremap <leader>nt :NERDTreeToggle<CR>
let g:NERDTreeHijackNetrw = 0
let g:NERDTreeIgnore = ['\.pyc$']
nnoremap <leader>nf :NERDTreeFind<cr>
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
vmap <silent> <localleader>vs :call VimuxSlime()<CR>`>j^
vmap <silent> <localleader>vj Jgv:call VimuxSlime()<CR>u`>j^
vmap <silent> <localleader>vyp Jgv:call VimuxCopyPostres()<CR>u`>j^
vmap <silent> <localleader>v; Jgv:call VimuxSlimeSemicolon()<CR>u`>j^
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
nnoremap <silent> <localleader>vf :w<CR>:call VimuxRunCommand(GetExecuteCommand())<CR>
nnoremap <silent> <localleader>vw :call VimuxRunCommand(GetNodemonCommand())<CR>
nmap <silent> <localleader>vr <localleader>vq:call VimuxRunCommand(GetReplCommand())<CR>
nnoremap <silent> <localleader>vtp :call VimuxRunPagarmeTest()<cr>

function! VimuxSlime() range
  call VimuxRunCommand(s:get_visual_selection())
endfunction

function! VimuxRunPagarmeTest()
  if getcwd() =~ '.*gateway^'
    let script = './script/test-unit'
  else
    let script = './script/test'
  endif

  call VimuxRunCommand('exec-notify '. script . ' ' . expand('%'))
endfunction

function! VimuxSlimeLineBreak() range
  call VimuxSlime()
  call VimuxSendKeys('Enter')
endfunction

function! VimuxSlimeSemicolon() range
  call VimuxRunCommand(s:get_visual_selection() . '\;')
endfunction

function! VimuxCopyPostres() range
  call VimuxRunCommand('\COPY (' . s:get_visual_selection() . ") TO PROGRAM 'pbcopy' DELIMITER e'\\t' CSV HEADER\;")
endfunction

function! GetExecuteCommand()
  let filetype_to_command = {
        \   'javascript': 'node',
        \   'coffee': 'coffee',
        \   'python': 'python',
        \   'html': 'open',
        \   'ruby': 'ruby',
        \   'sh': 'sh',
        \   'bash': 'bash'
        \ }
  let cmd = get(filetype_to_command, &filetype, &filetype)
  return cmd . " " . expand("%")
endfunction

function! GetNodemonCommand()
  let filetype_to_extension = {
        \   'javascript': 'js',
        \   'coffee': 'coffee',
        \   'python': 'py',
        \   'ruby': 'rb'
        \ }
  let extension = get(filetype_to_extension, &filetype, &filetype)
  let cmd = GetExecuteCommand()
  return  'nodemon -L -e "' . extension . '" -x "' . cmd . '"'
endfunction

function! GetReplCommand()
  let filetype_to_repl = {
        \   'javascript': 'node',
        \   'ruby': 'rbenv exec pry',
        \   'sql': 'pagarme_postgres'
        \ }
  let repl_bin = get(filetype_to_repl, &filetype, &filetype)
  echo repl_bin
  return  repl_bin
endfunction

" Python specific shortcuts
augroup python_vimux_shortuts
  autocmd!
  autocmd FileType python vmap <buffer> <localleader>vs :call VimuxSlimeLineBreak()<CR>`>j^
  autocmd FileType python nmap <localleader><CR> V:call VimuxSlime()<CR>`>j^
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
" # GUndo  {{{
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
call textobj#user#map('python', {
      \   'class': {
      \     'select-a': 'aP',
      \     'select-i': 'iP',
      \   },
      \ })
let g:textobj_python_no_default_key_mappings = 1

call textobj#user#map('indent', { '-': { 'select-a': 'ai', 'select-i': 'ii' } })
let g:textobj_indent_no_default_key_mappings = 1
nnoremap <leader>saq ?\v('''\|""")<CR>vw//e<CR>
nnoremap <leader>siq ?\v('''\|""")<CR>wv//e<CR>ge

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

nnoremap <silent> <leader>a viw:<c-u>call CallFzfAg()<cr>
vnoremap <silent> <leader>a :<c-u>call CallFzfAg()<cr>
nnoremap <silent> <leader>li :BLines<cr>
nnoremap <silent> <leader>hp :Helptags<cr>
nnoremap <silent> <leader>cm :Commands<cr>
nnoremap <silent> <leader>hi :History:<cr>
nnoremap <silent> <leader>ft :Filetypes<cr>

function! CallFzfAg()
  let selection = s:get_visual_selection()
  execute "Ag " . selection
endfunction

" "}}}
" # Unite.vim {{{
" Plugin extractable configuration
" Set default matcher options
" Lazy loadable?
" # Unite buffer options {{{
" Plugn extractable
call unite#custom#source('grep, lines', 'max_candidates', 1000)
call unite#custom#source('grep', 'sorters', 'sorter_rank')
call unite#custom#source('location_list, quickfix', 'sorters', 'sorter_nothing')
call unite#filters#matcher_default#use(['matcher_fuzzy'])
call unite#filters#sorter_default#use(['sorter_rank'])
call unite#custom#profile('default', 'context', {
      \   'start_insert': 0,
      \   'winheight': 15,
      \   'direction': 'topleft',
      \ })

let g:unite_quickfix_is_multiline=0
call unite#custom_source('quickfix', 'converters', 'converter_quickfix_highlight')
call unite#custom_source('location_list', 'converters', 'converter_quickfix_highlight')

augroup unite_settings
  autocmd!
  autocmd FileType unite call s:unite_my_settings()
augroup end

function! s:unite_my_settings()
  nmap <buffer> <C-z> <Plug>(unite_toggle_transpose_window)
  imap <buffer> <C-z> <Plug>(unite_toggle_transpose_window)
  nmap <buffer> J <Plug>(unite_toggle_auto_preview)
  nmap <buffer> K <Plug>(unite_print_candidate)
  nmap <buffer> L <Plug>(unite_redraw)
  nunmap <buffer> <c-k>
  nunmap <buffer> <c-l>
  nunmap <buffer> <c-h>
  imap <buffer> <C-j> <Plug>(unite_toggle_auto_preview)
  nmap <buffer> <C-r> <Plug>(unite_narrowing_input_history)
  imap <buffer> <C-r> <Plug>(unite_narrowing_input_history)
  nmap <buffer> <Tab> <Plug>(unite_complete)
  imap <buffer> <Tab> <Plug>(unite_complete)
  nmap <buffer> <C-@> <Plug>(unite_choose_action)
  imap <buffer> <C-@> <Plug>(unite_choose_action)
  nmap <buffer> <esc> <Plug>(unite_exit)
  nmap <buffer> / <Plug>(unite_insert_enter)
  nmap <buffer><expr> v unite#do_action('left')
  imap <buffer><expr> <c-v> unite#do_action('left')
endfunction
" " }}}
" # Prefix shortcuts {{{
" Plugin extractable
nnoremap [unite] <Nop>
nmap s [unite]
nnoremap <silent> [unite]r :<C-u>UniteResume<CR>
nnoremap <silent> [unite]me :<C-u>Unite output:message<CR>
nnoremap <silent> [unite]u :<C-u>Unite ultisnips<CR>
nnoremap <silent> [unite]o :<C-u>Unite -direction=topleft -split outline<CR>
nnoremap <silent> [unite]tw :<c-u>Unite tmuxcomplete -default-action=append<cr>
nnoremap <silent> [unite]tl :<c-u>Unite tmuxcomplete/lines -default-action=append<cr>
nnoremap <silent> [unite]li :<c-u>Unite line<cr>
nnoremap <silent> [unite]mr :<C-u>Unite file_mru<cr>
nnoremap <silent> [unite]f :<C-u>Unite file_mru<cr>
nnoremap <silent> [unite]/ :<C-u>Unite line -input=<c-r>/<cr>
nnoremap <silent> [unite]bb :Unite -quick-match buffer<cr>
nnoremap <silent> [unite]qf :<c-u>Unite -wrap -prompt-direction=top quickfix<cr>
nnoremap <silent> [unite]ll :<c-u>Unite -wrap -prompt-direction=top location_list<cr>
nnoremap <silent> [unite][ :<c-u>UnitePrevious<cr><cr>
nnoremap <silent> [unite]] :<c-u>UniteNext<cr><cr>
nnoremap <silent> [unite]{ :<c-u>UniteFirst<cr><cr>
nnoremap <silent> [unite]} :<c-u>UniteLast<cr><cr>
" " }}}
" Ag grep config {{{
" Plugin extractable
let g:unite_source_rec_async_command = ['ag', '--follow', '--nocolor', '--nogroup', '--hidden', '-g', '']
let g:unite_source_grep_command = 'ag'
let g:unite_source_grep_default_opts = '-i --vimgrep --hidden --ignore ' .
      \ '''.hg'' --ignore ''.svn'' --ignore ''.git'' --ignore ''.bzr'''
let g:unite_source_grep_recursive_opt = ''
let g:unite_source_line_enable_highlight = 1

" }}}
" # File explorer (Ctrl+P) {{{
" Plugin extractable
let grep_source = has('nvim') ? 'file_rec/neovim' : 'file_rec/async'
nnoremap <silent> <expr> <leader><c-p> ":\<C-u>Unite -buffer-name=files " . grep_source . ":! file/new\<CR>"
vnoremap <silent> <expr> gf "\"uy:\<C-u>Unite -buffer-name=files " . grep_source . ":! -input=\<c-r>u\<CR>"
nmap <silent> gf viwgf

" "}}}
" # Other mappings {{{
nnoremap <silent> <leader><c-o> :<c-u>Unite jump<cr>
nmap <leader>epv :<c-u>Unite -input=.lvimrc file_rec/neovim<cr>
nmap <leader>spv :<c-u>LocalVimRC<cr>
nmap <leader>epg :<c-u>Unite file_rec/neovim:~/.vim/plugged<cr>
" "}}}
" " }}}
" # Indent guides configuration Neovim  {{{
let s:LocalIndentState = 0
function! ToggleLocalIndentFunction()
  if s:LocalIndentState
    LocalIndentGuide -hl
  else
    LocalIndentGuide +hl
  endif

  let s:LocalIndentState = !s:LocalIndentState
endfunction

command! ToggleLocalIndent call ToggleLocalIndentFunction()
nnoremap <leader>ig :ToggleLocalIndent<cr>
highlight LocalIndentGuide guifg=#4E4E4E guibg=black gui=inverse ctermfg=5 ctermbg=0 cterm=inverse

" "}}}
" # Neomake  {{{
" Lazy loadable
augroup neomake_save_linter
  autocmd!
  autocmd BufWritePost * Neomake
  autocmd BufWritePost *.ts Neomake! tsc
augroup end

let g:neomake_javascript_enabled_makers = ['eslint_d']

function! DefineNeomakeColors()
  hi NeomakeErrorSign ctermfg=white
endfunction

call DefineNeomakeColors()

augroup my_error_signs
  au!
  autocmd ColorScheme * call DefineNeomakeColors()
augroup END

let g:neomake_tsc_maker = {
      \ 'exe': 'tsc',
      \ 'args': [],
      \ 'errorformat':
      \ '%E%f %#(%l\,%c): error %m,' .
      \ '%E%f %#(%l\,%c): %m,' .
      \ '%Eerror %m,' .
      \ '%C%\s%\+%m'
      \ }

" "}}}
" # Polyglot  {{{
" Lazy loadable
let g:jsx_ext_required = 1

" "}}}
" # Vim autoswap  {{{
let g:autoswap_detect_tmux = 1

" "}}}
" # Delimitmate  {{{
" Extractable configuration
function! DelimitMateCompletion(key)
  " Because of a Deoplete bug, I have to repeat a key to try to restore
  " original vim behaviour
  return (delimitMate#ShouldJump() ? "\<Del>" : "")
        \ . "\<c-x>" . a:key . (pumvisible() ? a:key : "")
endfunction

function! CustomCompletion(key)
  return "\<c-x>" . a:key . (pumvisible() ? a:key : "")
endfunction

imap <expr> <c-x><c-l> DelimitMateCompletion("\<c-l>")
imap <expr> <c-x><c-n> CustomCompletion("\<c-n>")
imap <expr> <c-x><c-p> CustomCompletion("\<c-p>")
let g:delimitMate_expand_space = 1
let g:delimitMate_expand_cr = 1
let g:delimitMate_nesting_quotes = ['"','`', "'"]

if !exists('g:set_carriage_return')
  imap <CR> <C-G>u<Plug>delimitMateCR
  let g:set_carriage_return = 1
endif

augroup delimitmate_language_specific
  au!
  au FileType R,rmd let b:delimitMate_matchpairs = "(:),[:],{:}"
augroup END


" "}}}
" # Windowswap  {{{
let g:windowswap_map_keys = 0
command! WindowSwap call WindowSwap#EasyWindowSwap()

" "}}}
" # Vimwiki  {{{
" Extractable configuration
let g:vimwiki_list = [{
      \ 'path': '~/Dropbox/Apps/vimwiki/wiki',
      \ 'path_html': '~/Dropbox/Apps/vimwiki/html',
      \ 'template_default': 'default',
      \ 'template_ext': '.tpl',
      \ 'template_path': '~/Dropbox/Apps/vimwiki/templates'
      \ }]

augroup vimwiki_shortcuts
  autocmd!
  autocmd FileType vimwiki nnoremap <buffer> [d :VimwikiDiaryPrevDay<cr>
  autocmd FileType vimwiki nnoremap <buffer> ]d :VimwikiDiaryNextDay<cr>
  autocmd FileType vimwiki nmap <buffer> ]l <Plug>VimwikiNextLink
  autocmd FileType vimwiki nmap <buffer> [l <Plug>VimwikiPrevLink
  autocmd FileType vimwiki iunmap <buffer> <C-L><C-J>
  autocmd FileType vimwiki iunmap <buffer> <C-L><C-K>
  autocmd FileType vimwiki iunmap <buffer> <C-L><C-M>
  autocmd FileType vimwiki iunmap <buffer> <Tab>
augroup end

" "}}}
" # incsearch.vim  {{{
" Extractable configuration
" Lazy loadable
map g/ <Plug>(incsearch-stay)
" "}}}
" # Highlightedyank  {{{
let g:highlightedyank_highlight_duration = 200
" "}}}
" # Nvim-R  {{{
augroup r_vim_settings
  autocmd!
  autocmd FileType r,rmd vmap <buffer> <localleader><CR> <localleader>sd
  autocmd FileType r,rmd nmap <buffer> <localleader><CR> <localleader>d
  autocmd FileType r,rmd nmap <buffer> <CR> <localleader>d
  autocmd VimLeave * if exists("g:SendCmdToR") && string(g:SendCmdToR) != "function('SendCmdToR_fake')" | call RQuit("nosave") | endif
augroup END
let R_assign = 0
let R_in_buffer = 0
let R_applescript = 0
let R_tmux_split = 1
" "}}}
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
" # Nvim miniwank  {{{
if has('nvim')
  map p <Plug>(miniyank-autoput)
  map P <Plug>(miniyank-autoPut)
  map <leader>p <Plug>(miniyank-cycle)
endif
" "}}}
