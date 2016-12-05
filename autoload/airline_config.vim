function! airline_config#init()
  let g:airline_section_a = airline#section#create(['mode'])
  let g:airline_section_b = airline#section#create(['file', ' ', 'readonly'])
  let g:airline_section_c = airline#section#create(['%{g:unite_outline_closest_tag}'])
  let g:airline_section_x = airline#section#create([])
  let g:airline_section_y = airline#section#create(['%<', 'branch'])
  let g:airline_section_z = airline#section#create(['%p%% ', '%{g:airline_symbols.linenr}%#__accent_bold#%l%#__restore__#:%v'])
endfunction
