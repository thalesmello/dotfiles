let g:multi_cursor_exit_from_insert_mode = 0
let g:multi_cursor_exit_from_visual_mode = 0
let g:deoplete#auto_complete_delay = 100

function! Multiple_cursors_before()
  if get(g:, 'cm_smart_enable', 1) == 1
	call cm#disable_for_buffer()
  endif
endfunction

function! Multiple_cursors_after()
  if get(g:, 'cm_smart_enable', 1) == 1
	call cm#enable_for_buffer()
  endif
endfunction

nnoremap g<c-n> :MultipleCursorsFind \<<c-r><c-w>\><cr>
vnoremap g<c-n> :call multiplecursors_config#smart_visual_select()<cr>
nnoremap <c-_> :MultipleCursorsFind<space>
vnoremap <c-_> :MultipleCursorsFind<space>

