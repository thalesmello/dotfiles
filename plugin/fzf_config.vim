let g:fzf_history_dir = '~/.local/share/fzf-history'
let $FZF_DEFAULT_COMMAND = 'ag -g ""'

nnoremap <silent><c-p> :<c-u>Files<cr>
vnoremap <silent><c-p> :<c-u>Files<cr>
nnoremap <c-f> :<c-u>Ag<space>
nnoremap <silent> <leader>/ :<c-u>Ag <c-r><c-w><cr>
vnoremap <silent> <leader>/ :<c-u>call fzf_config#visual_ag()<cr>
nnoremap <silent> <leader>ft :Filetypes<cr>

fun! CompleteAg(A,L,P)
    if a:A == ''
        return a:A
    endif
    return system("ag -o " . shellescape('\b\w*' . a:A . '\w*\b') . ' | cut -d":" -f3- | sort | uniq -c | sort -k1,1 -n -r | awk "{ print \$2 }"')
endfun

function! s:p(bang, ...)
  let preview_window = get(g:, 'fzf_preview_window', a:bang && &columns >= 80 || &columns >= 120 ? 'right': '')
  if len(preview_window)
    return call('fzf#vim#with_preview', add(copy(a:000), preview_window))
  endif
  return {}
endfunction

command! -bang -complete=custom,CompleteAg -nargs=* Ag call fzf#vim#ag(<q-args>, s:p(<bang>0), <bang>0)


if exists('$TMUX') && !empty(trim(system("tmux show -gqv '@tmux-popup' || true")))
  let g:fzf_layout = { 'tmux': '-p90%,60%' }
else
  let g:fzf_layout = { 'window': { 'width': 0.9, 'height': 0.6 } }
endif
