; extends
(term value: _ @sql-term.expr) @sql-term.term

((cte (statement) @sql-cte.statement)) @sql-cte.cte

[
     (from) @sql-select.inner
     (select) @sql-select.inner 
]

((select) @_start (from) @_end (#make-range! "sql-select.statement" @_start @_end))
