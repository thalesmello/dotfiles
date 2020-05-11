if match(&runtimepath, 'ncm2') == -1
    finish
endif

imap <c-space> <Plug>(ncm2_manual_trigger)

augroup Ncm2Config
  autocmd!
  autocmd User ClapOnEnter call ncm2#disable_for_buffer()
  autocmd BufEnter * call ncm2#enable_for_buffer()
augroup END

