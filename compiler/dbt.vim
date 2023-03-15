if exists("current_compiler")
  finish
endif

let current_compiler = "dbt"

if exists(":CompilerSet") != 2		" older Vim always used :setlocal
  command -nargs=* CompilerSet setlocal <args>
endif

CompilerSet efm  =%E%*[^\ ]%*\\sDatabase\ Error\ in\ model\ %o\ (%.%#),
CompilerSet efm +=%C%*[^\ ]%*\\s%m\ at\ [%l:%c],
CompilerSet efm +=%Z%*[^\ ]%*\\scompiled\ Code\ at\ %f

CompilerSet makeprg=dbt\ run
