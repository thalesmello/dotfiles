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

" Using floating windows of Neovim to start fzf
if has('nvim-0.4.0')
  let $FZF_DEFAULT_OPTS .= ' --color=bg:#20242C --border --layout=reverse'
  function! FloatingFZF()
    let width = float2nr(&columns * 0.9)
    let height = float2nr(&lines * 0.6)
    let opts = {
          \ 'relative': 'editor',
          \ 'row': (&lines - height) / 2,
          \ 'col': (&columns - width) / 2,
          \ 'width': width,
          \ 'height': height,
          \ 'style': 'minimal'
          \}

    let win = nvim_open_win(nvim_create_buf(v:false, v:true), v:true, opts)
  endfunction

  let g:fzf_layout = { 'window': 'call FloatingFZF()' }
endif
