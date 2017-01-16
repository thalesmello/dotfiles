"/ OriginalAuthor: Pedro Franceschi <pedrohfranceschi@gmail.com>
" ModifiedVersion: Thales Mello <thalesmello@gmail.com>
" Source: http://github.com/thalesmello/vimfiles

call plug#begin()
Plug 'tpope/vim-sensible'
Plug 'fatih/vim-go'
Plug 'morhetz/gruvbox'
Plug 'thalesmello/tabfold'
Plug 'tpope/vim-commentary'
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
Plug 'tpope/vim-rsi'
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
Plug 'lotabout/skim', { 'dir': '~/.skim', 'do': './install' }
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
" Plug 'machakann/vim-highlightedyank'
Plug 'vim-scripts/ingo-library'
Plug 'vim-scripts/SyntaxRange'
Plug 'jalvesaq/Nvim-R'
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
Plug 'thalesmello/webcomplete.vim',     only#if(has('nvim'))
Plug 'zchee/deoplete-jedi',             only#if(has('nvim'), {'for': 'python'})
Plug 'mhartington/deoplete-typescript', only#if(has('nvim'), {'for': 'javascript'})
Plug 'Shougo/neco-vim'
Plug 'zchee/deoplete-go'
Plug 'thalesmello/tmux-complete.vim'

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

" Database
Plug 'ivalkeen/vim-simpledb'
Plug 'exu/pgsql.vim'

" TODO: Check
" github-complete.vim
" committia.vim
" make outline use ctags for JavaScript

call plug#end()

let mapleader = "\<space>"
let maplocalleader = "'"
