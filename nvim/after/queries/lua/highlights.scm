; extends



(function_definition . "function" @conceal (#set! conceal "𝑓"))

(function_definition . "function"
  body: (block (return_statement . "return" @conceal (#set! conceal "→") .)) . "end" .)

(function_definition . "function"
  body: (block . _ .) . "end" @conceal (#set! conceal "") .)
