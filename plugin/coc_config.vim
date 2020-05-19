call coc#add_extension(
	  \ 'coc-highlight',
	  \ 'coc-python',
	  \ 'coc-json',
	  \ 'coc-pairs',
	  \ 'coc-yaml',
	  \ 'coc-snippets'
	  \)

nmap <silent> [g <Plug>(coc-diagnostic-prev)
nmap <silent> ]g <Plug>(coc-diagnostic-next)

nmap <silent> <leader><c-]> <Plug>(coc-definition)
nmap <silent> K <cmd>call <SID>show_documentation()<CR>
nmap <silent> gr <Plug>(coc-rename)
nmap gR <Plug>(coc-refactor)
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
nnoremap <silent> <leader>cl <cmd>CocList lists<cr>
nmap <silent> <leader>cr <Plug>(coc-references)
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
  call auto#cmd('set_snippets_filetype', 'BufRead *.snippets setlocal filetype=snippets')
augroup end


nmap <leader>esp <cmd>CocCommand snippets.editSnippets<cr>
xmap <tab> <Plug>(coc-snippets-select)

let g:coc_snippet_next = '<c-l>'
let g:coc_snippet_prev = '<c-h>'

inoremap <silent><expr> <TAB>
      \ pumvisible() ? coc#_select_confirm() :
      \ coc#expandableOrJumpable() ? "\<C-r>=coc#rpc#request('doKeymap', ['snippets-expand-jump',''])\<CR>" :
      \ <SID>check_back_space() ? "\<TAB>" :
      \ coc#refresh()



function! s:check_back_space() abort
  let col = col('.') - 1
  return !col || getline('.')[col - 1]  =~# '\s'
endfunction


if !exists("g:mapped_coc_cr")
  let g:mapped_coc_cr = 1
  inoremap <silent><expr> <Plug>CustomCocCR pumvisible() ? coc#_select_confirm() : "\<C-g>u\<CR>\<c-r>=coc#on_enter()\<CR>"
  imap <CR> <Plug>CustomCocCR
endif

nmap <silent> <C-_> <Plug>(coc-cursors-word)*
xmap <silent> <C-_> y/\V<C-r>=escape(@",'/\')<CR><CR>gN<Plug>(coc-cursors-range)gn
nmap <leader><c-_> :CocSearch<space>

