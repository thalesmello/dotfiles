" Change file_rec command.
call denite#custom#var('file_rec', 'command', ['ag', '--follow', '--nocolor', '--nogroup', '-g', ''])

" Change mappings.
" Insert mode mappings
call denite#custom#map('insert', '<C-n>', '<denite:move_to_next_line>', 'noremap')
call denite#custom#map('insert', '<C-p>', '<denite:move_to_previous_line>', 'noremap')
call denite#custom#map('insert', '<Down>', '<denite:move_to_next_line>', 'noremap')
call denite#custom#map('insert', '<Up>', '<denite:move_to_previous_line>', 'noremap')
call denite#custom#map('insert', '<c-v>', '<denite:do_action:vsplit>', 'noremap')
call denite#custom#map('insert', '<c-r>', '<denite:assign_next_matched_text>', 'noremap')
call denite#custom#map('insert', '<c-s>', '<denite:assign_previous_matched_text>', 'noremap')
call denite#custom#map('insert', '<c-j>', '<denite:do_action:preview>', 'noremap')
call denite#custom#map('insert', '<c-a>', '<denite:move_caret_to_head>', 'noremap')
call denite#custom#map('insert', '<c-e>', '<denite:move_caret_to_tail>', 'noremap')
call denite#custom#map('insert', '<c-b>', '<denite:move_caret_to_left>', 'noremap')
call denite#custom#map('insert', '<c-f>', '<denite:move_caret_to_right>', 'noremap')
call denite#custom#map('insert', '<c-x>', '<denite:toggle_select_down>', 'noremap')

" Change sorters.
call denite#custom#source('file_rec', 'sorters', ['sorter_sublime'])

" Change default prompt
call denite#custom#option('default', 'prompt', '>')

" Change ignore_globs
call denite#custom#filter('matcher_ignore_globs', 'ignore_globs',
	  \ [ '.git/', '.ropeproject/', '__pycache__/',
	  \   'venv/', 'images/', '*.min.*', 'img/', 'fonts/'])

nnoremap <silent> <leader>dd :Denite -resume<cr>
nnoremap <silent> <leader>dq :Denite -auto-resize quickfix<cr>
nnoremap <silent> <leader>dl :Denite -auto-resize location_list<cr>
nnoremap <silent> <leader>du :Denite unite:ultisnips<CR>
nnoremap <silent> <leader>d/ :Denite line<cr>
nnoremap <silent> <leader>[  :Denite -resume -cursor-pos=-1 -immediately<cr>
nnoremap <silent> <leader>]  :Denite -resume -cursor-pos=+1 -immediately<cr>

