" Navigation shortcuts
nnoremap <c-h> <c-w>h
nnoremap <c-l> <c-w>l
nnoremap <c-j> <c-w>j
nnoremap <c-k> <c-w>k
nnoremap <leader><c-p> :tabprevious<cr>
nnoremap <leader><c-n> :tabnext<cr>

nnoremap <leader>1 1gt
nnoremap <leader>2 2gt
nnoremap <leader>3 3gt
nnoremap <leader>4 4gt
nnoremap <leader>5 5gt
nnoremap <leader>6 6gt
nnoremap <leader>7 7gt
nnoremap <leader>8 8gt
nnoremap <leader>9 9gt

" Create windows
nnoremap <leader>v <C-w>v
nnoremap <leader>% <C-w>v
nnoremap <leader>" <C-w>s
nnoremap <leader><bs> <c-w>q

" Edit and load vimrc
nnoremap <leader>ev :vsplit $MYVIMRC<cr>
nnoremap <leader>ec :vsplit $MYVIMRC<cr>:Econfig<space>
nnoremap <leader>ea :vsplit $MYVIMRC<cr>:Eautoload<space>
nnoremap <silent> <leader>s% :if &ft == 'vim' <bar> source % <bar> endif<cr>

" Fix syntax highlighting
nnoremap <leader>sf <cmd>syntax sync fromstart<cr>

" Smart lookup for command line
cnoremap <expr> <c-p> pumvisible() ? "\<c-p>" : "\<up>"
cnoremap <expr> <c-n> pumvisible() ? "\<c-n>" : "\<down>"

" The snippet below tries to intelligently split a string and append a concat
" operator in it

nnoremap <leader>y "+y
nnoremap <leader>Y "+y$
nnoremap <leader>p "+p
nnoremap <leader>P "+P

vnoremap <leader>y "+y
vnoremap <leader>p "+p
vnoremap <leader>P "+P

vnoremap @ :<c-u>noautocmd '<,'> normal @
nnoremap <leader><leader> <c-^>
nnoremap <expr> <leader>o getpos('.') == getpos("'[") ? "`]" : "`["
vmap <leader>c* *Ncgn
nmap c* *Ncgn
nnoremap Y y$
nnoremap <leader>fw :FixWhitespace<cr>
noremap <c-e> 2<c-e>
noremap <c-y> 2<c-y>
nnoremap <leader>= <c-w>=
nnoremap <leader>+ <c-w>\|<c-w>_
nnoremap <leader>\| <c-w>\|
nnoremap <S-ScrollWheelUp>   <ScrollWheelLeft>
nnoremap <S-2-ScrollWheelUp> <2-ScrollWheelLeft>
nnoremap <S-3-ScrollWheelUp> <3-ScrollWheelLeft>
nnoremap <S-4-ScrollWheelUp> <4-ScrollWheelLeft>
nnoremap <S-ScrollWheelDown>     <ScrollWheelRight>
nnoremap <S-2-ScrollWheelDown>   <2-ScrollWheelRight>
nnoremap <S-3-ScrollWheelDown>   <3-ScrollWheelRight>
nnoremap <S-4-ScrollWheelDown>   <4-ScrollWheelRight>

" Silence write file so it doesn't pollute history
nnoremap <silent> :w<cr> :write<cr>
nnoremap <silent> :q<cr> :quit<cr>

" Make [[ navigation more useful for when { not in first column
map <silent> [[ :<c-u>keeppatterns normal ?{<c-v><cr>w99[{<cr>
map <silent> ][ :<c-u>keeppatterns normal /}<c-v><CR>b99]}<cr>
map <silent> ]] :<c-u>keeppatterns normal j0[[%/{<c-v><cr><CR>
map <silent> [] :<c-u>keeppatterns normal k$][%?}<c-v><cr><CR>

vmap : <esc>gv<Plug>SwapVisualCursor
vnoremap <expr> <Plug>SwapVisualCursor line('.') == line("'<") ? ':' : 'o:'

fun! ChangeReg() abort
  let x = nr2char(getchar())
  call feedkeys("q:ilet @" . x . " = \<c-r>\<c-r>=string(@" . x . ")\<cr>\<esc>0f'", 'n')
endfun
nnoremap <leader>er :call ChangeReg()<cr>

nnoremap <silent> <bs> :nohlsearch<cr>:pclose<cr>:diffoff<cr>

