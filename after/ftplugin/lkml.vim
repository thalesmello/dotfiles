if exists('g:created_lkml_sql_autocommands')
  finish
endif

call OnSyntaxChange#Install('SqlBody', 'lkmlSqlBody', 0, 'n')
autocmd User SyntaxSqlBodyEnterN silent! let b:commentary_format = "-- %s"
autocmd User SyntaxSqlBodyLeaveN silent! unlet b:commentary_format

let g:created_lkml_sql_autocommands = 1
