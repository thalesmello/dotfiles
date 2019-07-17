call SyntaxRange#Include('\$\$', '\$\$\s\+LANGUAGE\s\+plpythonu.*', 'python', 'sqlHereDocPython')

setlocal include=ref(\\('\|\"\\)\\zs\\w*\\ze\\('\|\"\\))
setlocal path+=models/*
setlocal suffixesadd+=.sql
