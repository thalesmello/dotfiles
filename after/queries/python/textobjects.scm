; extends
[(pair
   key: (_) @pair.key
   value: (_) @pair.value)

 (keyword_argument
   name: (_) @pair.key
   value: (_) @pair.value)]

(string
  . (string_start) @str-start (#any-of? @str-start "\"\"\"" "f\"\"\"" "f'''")
  . (_) @_start
  (_) @_end . (string_end) @str-end (#eq? @str-end @str-end) . (#make-range! "multiline_string.inner" @_start @_end)) @multiline_string.outer
