nnoremap <silent><c-p> :<c-u>Files<cr>
vnoremap <silent><c-p> :<c-u>Files<cr>

let g:fzf_history_dir = '~/.local/share/fzf-history'
let $FZF_DEFAULT_COMMAND = 'ag -g ""'

nnoremap <silent> <leader>a :<c-u>Ag <c-r><c-w><cr>
vnoremap <silent> <leader>a :<c-u>call fzf_config#visual_ag()<cr>
nnoremap <silent> <leader>li :BLines<cr>
nnoremap <silent> <leader>hp :Helptags<cr>
nnoremap <silent> <leader>cm :Commands<cr>
nnoremap <silent> <leader>hi :History:<cr>
nnoremap <silent> <leader>ft :Filetypes<cr>

nnoremap <c-f> :<c-u>Ag<space>


fun! CompleteAg(A,L,P)
    if a:A == ''
        return a:A
    endif
    return system("ag -o " . shellescape('\b\w*' . a:A . '\w*\b') . ' | cut -d":" -f3- | sort | uniq -c | sort -k1,1 -n -r | awk "{ print \$2 }"')
endfun

command! -bang -complete=custom,CompleteAg -nargs=* Ag call fzf#vim#ag(<q-args>, <bang>0)
