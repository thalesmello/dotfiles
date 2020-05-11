if match(&runtimepath, 'nvim-lsp') == -1
    finish
endif

lua << END

require'nvim_lsp'.vimls.setup{}
require'nvim_lsp'.pyls.setup{}

END


nnoremap <silent> <c-]> <cmd>lua vim.lsp.buf.definition()<CR>
nnoremap <silent> K     <cmd>lua vim.lsp.buf.hover()<CR>
nnoremap <silent> gK     <cmd>lua vim.lsp.buf.signature_help()<CR>
nnoremap <silent> g*     <cmd>lua vim.lsp.buf.document_highlight()<CR>
nnoremap <silent> gr    <cmd>lua vim.lsp.buf.references()<CR>
nnoremap <silent> gR    <cmd>lua vim.lsp.buf.rename()<cr>
nnoremap <silent> g0    <cmd>lua vim.lsp.buf.document_symbol()<CR>
