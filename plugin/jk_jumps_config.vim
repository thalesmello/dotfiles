nnoremap <expr> j v:count > 0 ? ":\<c-u>call jk_jumps_config#jump('j')\<cr>" : 'gj'
nnoremap <expr> k v:count > 0 ? ":\<c-u>call jk_jumps_config#jump('k')\<cr>" : 'gk'
