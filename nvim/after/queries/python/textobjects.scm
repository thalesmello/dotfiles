; extends
[(pair
   key: (_) @pair.key
   value: (_) @pair.value)

 (keyword_argument
   name: (_) @pair.key
   value: (_) @pair.value)]

(string
  . (string_start) @str-start (#any-of? @str-start "\"\"\"" "'''" "f\"\"\"" "f'''")
  . ((_)*) @multiline_string.inner
  (string_end) @str-end (#eq? @str-end @str-end) .) @multiline_string.outer
