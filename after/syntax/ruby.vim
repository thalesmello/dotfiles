call SyntaxRange#Include('\C^[^\#]*<<-SQL.*$', '\CSQL', 'sql', 'rubyHereDocSQL')
call SyntaxRange#Include('\C^[^\#]*<<-JSON.*$', '\CJSON', 'json', 'rubyHereDocJson')
