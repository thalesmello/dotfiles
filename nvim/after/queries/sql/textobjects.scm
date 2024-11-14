; extends
((term value: _ @sql-term.expr) @_start ","? @_end (#make-range! "sql-term.term" @_start @_end))

((cte (statement) @sql-cte.statement) @_start ","? @_end (#make-range! "sql-cte.cte" @_start @_end))

[
     (from) @sql-select.inner
     (select) @sql-select.inner
]

((select) @_start (from) @_end (#make-range! "sql-select.statement" @_start @_end))
