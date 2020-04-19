function! tmux_complete#conditional_disable()
    if !exists('$TMUX')
        return
    endif

    if !executable('tmate')
        return
    endif


    if empty(trim(system("tmate show -qvg '@is-tmate' || true")))
        return
    endif

    call ncm2#override_source('tmux-complete', {'enable': 0})
endfunction
