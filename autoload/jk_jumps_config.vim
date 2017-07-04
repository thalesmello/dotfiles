function! jk_jumps_config#jump(key) range
    exec "normal! ".v:count1.a:key
    if v:count1 >= 7
        let target = line('.')
        let bkey = 'k'
        if (a:key == 'k')
            let bkey = 'j'
        endif
        exec "normal! ".v:count1.bkey
        exec "normal! ".target."G"
    endif
endfunction
