let g:LanguageClient_serverCommands = {
    \ 'rust': ['rustup', 'run', 'nightly', 'rls'],
    \ 'javascript': ['typescript-language-server', '--stdio'],
    \ 'javascript.jsx': ['typescript-language-server', '--stdio'],
    \ }

nnoremap <silent> gK :call LanguageClient_textDocument_hover()<CR>
nnoremap <silent> g<c-]> :call LanguageClient_textDocument_definition()<CR>
nnoremap <silent> <F2> :call LanguageClient_textDocument_rename()<CR>

    " \ 'typescript': ['typescript-language-server', '--stdio'],
