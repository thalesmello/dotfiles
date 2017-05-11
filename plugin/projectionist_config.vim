let g:projectionist_heuristics = {
			\ "autoload/&plugin/": {
			\     "autoload/*.vim": { "alternate": "plugin/{}.vim" },
			\     "plugin/*.vim": { "alternate": "autoload/{}.vim" }
			\   }
			\ }
