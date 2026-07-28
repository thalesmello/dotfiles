; extends

(string
  . (string_start) @str-start (#any-of? @str-start "\"\"\"" "'''" "f\"\"\"" "f'''")
  . (string_content) @sqlcontents @injection.content
  (string_end) @str-end (#eq? @str-end @str-end) (#contains? @sqlcontents "SELECT") (#set! injection.language "sql") (#set! injection.include-children) .)
