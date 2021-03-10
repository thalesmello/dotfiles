if get(g:, 'started_by_firenvim', 0) == 0
    finish
end

set guifont=InconsolataGoNerdFontCompleteM-Regular:h17

let g:firenvim_config = {
    \ 'localSettings': {
        \ '.*': {
            \ 'takeover': 'never',
        \ }
    \ }
\ }
