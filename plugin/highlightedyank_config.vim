augroup highlightedyank
	autocmd!
    au TextYankPost * silent! lua require'vim.highlight'.on_yank("IncSearch", 200)
augroup end
