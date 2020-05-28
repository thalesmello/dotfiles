if !has('nvim')
  finish
endif

let s:terminal = 'term://neovim-fish'

noremap <silent> <c-space><c-h> <C-w><C-h>
noremap <silent> <c-space><c-j> <C-w><C-j>
noremap <silent> <c-space><c-k> <C-w><C-k>
noremap <silent> <c-space><c-l> <C-w><C-l>

tnoremap <silent> <c-space><c-h> <C-\><C-n><C-w><C-h>
tnoremap <silent> <c-space><c-j> <C-\><C-n><C-w><C-j>
tnoremap <silent> <c-space><c-k> <C-\><C-n><C-w><C-k>
tnoremap <silent> <c-space><c-l> <C-\><C-n><C-w><C-l>

tnoremap <silent> <c-space><space> <C-\><C-n>
tnoremap <silent> <c-space><bs> <C-\><C-n><c-w>q
nnoremap <silent> <c-space><bs> <c-w>q


tnoremap <silent> <c-space><c-n> <C-\><C-n><c-w>gt
nnoremap <silent> <c-space><c-n> gt
tnoremap <silent> <c-space><c-p> <C-\><C-n><c-w>gT
nnoremap <silent> <c-space><c-p> gT

tmap <silent> <c-space>J <C-\><C-n><leader>J
tmap <silent> <c-space>H <C-\><C-n><leader>H
tmap <silent> <c-space>K <C-\><C-n><leader>K
tmap <silent> <c-space>L <C-\><C-n><leader>L
nmap <silent> <c-space>J <leader>J
nmap <silent> <c-space>H <leader>H
nmap <silent> <c-space>K <leader>K
nmap <silent> <c-space>L <leader>L

tnoremap <c-space>1 <c-\><c-n>1gt
tnoremap <c-space>2 <c-\><c-n>2gt
tnoremap <c-space>3 <c-\><c-n>3gt
tnoremap <c-space>4 <c-\><c-n>4gt
tnoremap <c-space>5 <c-\><c-n>5gt
tnoremap <c-space>6 <c-\><c-n>6gt
tnoremap <c-space>7 <c-\><c-n>7gt
tnoremap <c-space>8 <c-\><c-n>8gt
tnoremap <c-space>9 <c-\><c-n>9gt

execute 'tnoremap <silent> <c-space>v <cmd>vsplit '.s:terminal.'<CR>'
execute 'nnoremap <silent> <c-space>v <cmd>vsplit '.s:terminal.'<CR>'
execute 'tnoremap <silent> <c-space>" <cmd>split '.s:terminal.'<CR>'
execute 'nnoremap <silent> <c-space>" <cmd>split '.s:terminal.'<CR>'
execute 'tnoremap <silent> <c-space>c <cmd>tabnew '.s:terminal.'<CR>'
execute 'nnoremap <silent> <c-space>c <cmd>tabnew '.s:terminal.'<CR>'

augroup neovim_terminal_group
  autocmd!

  autocmd BufWinEnter,WinEnter term://* startinsert
  autocmd BufLeave term://* stopinsert
augroup end
