; extends
((term value: _ @sql-term-expr) @_start ","? @_end (#make-range! "sql-term-term" @_start @_end))

[
 (cte (keyword_as) . (_) @_start (_) @_end . (#make-range! "sql-cte-inner" @_start @_end))
 (cte (keyword_as) . (_) @_start @_end . (#make-range! "sql-cte-inner" @_start @_end))
] @sql-cte-cte

[
     (from) @sql-select-inner
     (select) @sql-select-inner
]

((select) @_start (from) @_end (#make-range! "sql-select-statement" @_start @_end))
