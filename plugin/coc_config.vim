call coc#add_extension(
	  \ 'coc-ultisnips',
	  \ 'coc-highlight',
	  \ 'coc-python',
	  \ 'coc-json'
	  \)

nmap <silent> [g <Plug>(coc-diagnostic-prev)
nmap <silent> ]g <Plug>(coc-diagnostic-next)

nmap <silent> <leader><c-]> <Plug>(coc-definition)
nmap <silent> K <cmd>call <SID>show_documentation()<CR>
nmap <silent> gr <Plug>(coc-references)
nmap <silent> gR <Plug>(coc-rename)
nmap <silent> gI <Plug>(coc-implementation)
nmap <silent> gy <Plug>(coc-type-definition)

function! s:show_documentation()
  if (index(['vim','help'], &filetype) >= 0)
    execute 'h '.expand('<cword>')
  else
    call CocAction('doHover')
  endif
endfunction


xmap <leader>fm <Plug>(coc-format-selected)
nmap <leader>fm <Plug>(coc-format-selected)

nmap <leader>fi  <cmd>CocFix<cr>

xmap <leader>a  <Plug>(coc-codeaction-selected)
nmap <leader>a  <Plug>(coc-codeaction-selected)
nmap <leader>A  <Plug>(coc-codeaction)

inoremap <silent><expr> <c-space> coc#refresh()

command! -nargs=0 Format :call CocAction('format')
command! -nargs=? Fold :call CocAction('fold', <f-args>)
command! -nargs=0 OR :call CocAction('runCommand', 'editor.action.organizeImport')

nnoremap <silent> <leader>cd <cmd>CocList diagnostics<cr>
nnoremap <silent> <leader>ce <cmd>CocList extensions<cr>
nnoremap <silent> <leader>cc <cmd>CocList commands<cr>
nnoremap <silent> <leader>co <cmd>CocList outline<cr>
nnoremap <silent> <leader>cs <cmd>CocList -I symbols<cr>
nnoremap <silent> <leader>C <cmd>CocListResume<CR>

nnoremap <silent> <leader>]  :<C-u>CocNext<CR>
nnoremap <silent> <leader>[  :<C-u>CocPrev<CR>

nnoremap <leader>? <cmd>call CocActionAsync('showSignatureHelp')<cr>

augroup cocvim_group
  autocmd!
  " Setup formatexpr specified filetype(s).
  autocmd FileType typescript,json setl formatexpr=CocAction('formatSelected')

  autocmd FileType python setlocal tagfunc=CocTagFunc
  " Update signature help on jump placeholder.
  autocmd User CocJumpPlaceholder call CocActionAsync('showSignatureHelp')
  " Highlight the symbol and its references when holding the cursor.
  autocmd CursorHold * silent call CocActionAsync('highlight')
augroup end
