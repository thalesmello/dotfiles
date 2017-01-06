augroup neomake_linter
  autocmd!
  autocmd BufWritePost,BufReadPost * Neomake
  autocmd BufWritePost,BufReadPost *.ts Neomake! tsc
augroup end

let g:neomake_javascript_enabled_makers = ['eslint_d']
let g:neomake_java_enabled_makers = []

hi NeomakeErrorSign ctermfg=white

call auto#cmd('my_error_signs', 'ColorScheme * hi NeomakeErrorSign ctermfg=white')

let g:neomake_tsc_maker = {
      \ 'exe': 'tsc',
      \ 'args': [],
      \ 'errorformat':
      \ '%E%f %#(%l\,%c): error %m,' .
      \ '%E%f %#(%l\,%c): %m,' .
      \ '%Eerror %m,' .
      \ '%C%\s%\+%m'
      \ }
