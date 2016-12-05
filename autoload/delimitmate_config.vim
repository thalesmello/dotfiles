function! delimitmate_config#completion(key)
  " Because of a Deoplete bug, I have to repeat a key to try to restore
  " original vim behaviour
  return (delimitMate#ShouldJump() ? "\<Del>" : "")
        \ . "\<c-x>" . a:key . (pumvisible() ? a:key : "")
endfunction

