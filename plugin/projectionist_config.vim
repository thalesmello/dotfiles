let g:projectionist_heuristics = {
			\ "autoload/&plugin/": {
			\     "autoload/*.vim": { "alternate": "plugin/{}.vim" },
			\     "plugin/*.vim": { "alternate": "autoload/{}.vim" }
			\   },
			\ "models/*": {
			\ "models/*.sql": { "alternate": "models/{}.yml", "type": "model" },
			\ "models/*.yml": { "alternate": "models/{}.sql", "type": "doc" }
			\ }
			\ }
