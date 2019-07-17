let g:projectionist_heuristics = {
			\ "autoload/&plugin/": {
			\     "autoload/*.vim": { "alternate": "plugin/{}.vim", "type": "autoload" },
			\     "plugin/*.vim": { "alternate": "autoload/{}.vim", "type": "config" }
			\   },
			\ "models/*": {
			\ "models/*.sql": { "alternate": "models/{}.yml", "type": "model" },
			\ "models/*.yml": { "alternate": "models/{}.sql", "type": "doc" }
			\ }
			\ }
