if !exists('*ncm2#enable_for_buffer')
	finish
endif

autocmd BufEnter * call ncm2#enable_for_buffer()

imap <c-space> <Plug>(ncm2_manual_trigger)

augroup Ncm2Config
  autocmd!
  autocmd User ClapOnEnter call ncm2#enable_for_buffer()
augroup END
