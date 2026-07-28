" Vim syntax file
" Language: Malloy
" Maintainer: Generated from malloy-vscode-extension
" Latest Revision: 2025-11-20
" Based on: https://github.com/malloydata/malloy/tree/main/packages/malloy-syntax-highlight

if exists("b:current_syntax")
  finish
endif

" Case insensitive matching for Malloy
syntax case ignore

" Comments
" Block comments
syntax region malloyCommentBlock start="/\*" end="\*/" contains=malloyCommentBlock
" Line comments with //
syntax match malloyCommentLine "//.*$"
" Line comments with --
syntax match malloyCommentLine "--.*$"

" Strings
" Triple-quoted strings
syntax region malloyStringTriple start='"""' end='"""'
" Single-quoted strings with escapes
syntax region malloyStringSingle start="'" end="'" skip="\\." contains=malloyStringEscape
" Double-quoted strings with escapes
syntax region malloyStringDouble start='"' end='"' skip='\\.' contains=malloyStringEscape
" Regex strings
syntax region malloyRegex start="[r/]'" end="'" contains=malloyRegexEscape

" String escapes
syntax match malloyStringEscape "\\u[A-Fa-f0-9]\{4\}" contained
syntax match malloyStringEscape "\\." contained
syntax match malloyRegexEscape "\\." contained

" Numbers
syntax match malloyNumber "\v<((0|[1-9][0-9]*)(E[+-]?[0-9]+|\.%([0-9]*)=)|\.@<=[0-9]+)>"

" Constants
syntax keyword malloyConstant null true false

" Types
syntax keyword malloyType string number date timestamp boolean

" Datetimes
" Timestamp literals: @2023-01-15 12:30 or @2023-01-15T12:30:45.123[America/New_York]
syntax match malloyDateTime "@\d\{4}-\d\{2}-\d\{2}[ T]\d\{2}:\d\{2}\%(:\d\{2}\%(\%([.,]\d\+\)\%(\[[A-Za-z_/]\+\]\)\=\)\=\)\="
" Date literals: @2023, @2023-Q1, @2023-01, @2023-01-15, @2023-01-15-WK
syntax match malloyDateTime "@\d\{4}\%(-Q[1-4]\|-\d\{2}\%(-\d\{2}\%(-WK\)\=\)\=\)\="

" Timeframes
syntax keyword malloyTimeframe year years quarter quarters month months week weeks
syntax keyword malloyTimeframe day days hour hours minute minutes second seconds
syntax keyword malloyTimeframe day_of_year day_of_month

" Properties (Malloy-specific keywords)
syntax keyword malloyProperty accept select connection run extend refine
syntax keyword malloyProperty aggregate sample calculate timezone dimension
syntax keyword malloyProperty except source group_by drill grouped_by having
syntax keyword malloyProperty index join_one with join_many join_cross limit
syntax keyword malloyProperty measure nest order_by partition_by primary_key
syntax keyword malloyProperty project query rename top view where declare

" Keywords
syntax keyword malloyKeyword is on not or desc by and asc for else to when
syntax keyword malloyKeyword pick import internal public private include

" Built-in Functions
syntax keyword malloyFunction AVG COUNT FIRST FORMAT LAST LCASE LEN MAX MID MIN
syntax keyword malloyFunction MOD NOW ROUND SUM UCASE UNGROUPED

" Function calls with parentheses (general pattern)
syntax match malloyFunctionCall "\<\w\+\s*("me=e-1

" Function calls with type specifiers (e.g., my_func!timestamp())
syntax match malloyFunctionTyped "\<\w\+!\%(timestamp\|number\|string\|boolean\|date\)\=\s*("me=e-1

" Identifiers in backticks
syntax region malloyIdentifierQuoted start="`" end="`"

" Tags (Malloy annotation system)
" Tag comment: #"
syntax match malloyTagComment '#".*$'
" Tag with values: # key=value or ## key=value
syntax match malloyTag "##\=\s\+.*$" contains=malloyTagKey,malloyTagValue
syntax match malloyTagKey "\%(-\=\)\@<=\%([^ \t=#]\+\|\"[^#]\+\"\)" contained
syntax match malloyTagValue "=\s*\%([^ \t=#]\+\|\"[^#]\+\"\)" contained

" SQL string blocks
" Pattern: connection.sql("""...""")
syntax region malloySQL matchgroup=malloyKeyword start="\<\w\+\s*\.\s*sql\s*(\s*\"\"\"" end='"""' contains=@malloySQL,malloyMalloyInSQL

" Malloy code within SQL blocks (%{...}%)
syntax region malloyMalloyInSQL matchgroup=Delimiter start="%{" end="}%\=" contained contains=TOP

" Define highlight groups
highlight default link malloyCommentBlock Comment
highlight default link malloyCommentLine Comment
highlight default link malloyStringTriple String
highlight default link malloyStringSingle String
highlight default link malloyStringDouble String
highlight default link malloyRegex String
highlight default link malloyStringEscape SpecialChar
highlight default link malloyRegexEscape SpecialChar
highlight default link malloyNumber Number
highlight default link malloyConstant Constant
highlight default link malloyType Type
highlight default link malloyDateTime Constant
highlight default link malloyTimeframe Keyword
highlight default link malloyProperty Keyword
highlight default link malloyKeyword Keyword
highlight default link malloyFunction Function
highlight default link malloyFunctionCall Function
highlight default link malloyFunctionTyped Function
highlight default link malloyIdentifierQuoted Identifier
highlight default link malloyTag Special
highlight default link malloyTagComment Comment
highlight default link malloyTagKey Special
highlight default link malloyTagValue String
highlight default link malloySQL String

let b:current_syntax = "malloy"
