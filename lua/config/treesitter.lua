local ts_repeat_move = require "nvim-treesitter.textobjects.repeatable_move"
local langs = {"lua", "vim", "python", "ruby", "query"}

require'nvim-treesitter.configs'.setup {
   ensure_installed = langs,

   modules = {},
   sync_install = false,
   ignore_install = {},

   highlight = {
      enable = true,
      additional_vim_regex_highlighting = false,
   },

   auto_install = true,

   incremental_selection = {
      enable = true,
      keymaps = {
         init_selection = "ghh", -- set to `false` to disable one of the mappings
         node_incremental = "gh]",
         scope_incremental = "gh}",
         node_decremental = "gh[",
      },
   },

   indent = {
      enable = true
   },

   textobjects = {
      select = {
         enable = true,

         -- Automatically jump forward to textobj, similar to targets.vim
         lookahead = true,

         keymaps = {
            -- You can use the capture groups defined in textobjects.scm
            ["af"] = "@function.outer",
            ["if"] = "@function.inner",
            ["i,"] = "@parameter.inner",
            ["a,"] = "@parameter.outer",
            ["ic"] = "@comment.inner",
            ["ac"] = "@comment.outer",
            -- You can optionally set descriptions to the mappings (used in the desc parameter of
            -- nvim_buf_set_keymap) which plugins like which-key display
            ["iC"] = { query = "@class.inner", desc = "Select inner part of a class region" },
            ["aC"] = { query = "@class.outer", desc = "Select outer part of a class region" },
            -- You can also use captures from other query groups like `locals.scm`
            -- ["as"] = { query = "@scope", query_group = "locals", desc = "Select language scope" },
         },

         selection_modes = {
            ['@parameter.outer'] = 'v', -- charwise
            ['@function.outer'] = 'v', -- linewise
            -- ['@class.outer'] = '<c-v>', -- blockwise
         },

      },

      move = {
         enable = true,
         set_jumps = true, -- whether to set jumps in the jumplist
         goto_next_start = {
            ["],"] = "@parameter.outer",
            ["]m"] = "@function.outer",
            ["]]"] = { query = "@class.outer", desc = "Next class start" },
            --
            -- You can use regex matching (i.e. lua pattern) and/or pass a list in a "query" key to group multiple queires.
            ["]o"] = "@loop.*",
            -- ["]o"] = { query = { "@loop.inner", "@loop.outer" } }
            --
            -- You can pass a query group to use query from `queries/<lang>/<query_group>.scm file in your runtime path.
            -- Below example nvim-treesitter's `locals.scm` and `folds.scm`. They also provide highlights.scm and indent.scm.
            ["]s"] = { query = "@scope", query_group = "locals", desc = "Next scope" },
            ["]z"] = { query = "@fold", query_group = "folds", desc = "Next fold" },
         },
         goto_next_end = {
            ["]M"] = "@function.outer",
            ["]["] = "@class.outer",
         },
         goto_previous_start = {
            ["[,"] = "@parameter.outer",
            ["[m"] = "@function.outer",
            ["[["] = "@class.outer",
         },
         goto_previous_end = {
            ["[M"] = "@function.outer",
            ["[]"] = "@class.outer",
         },
         -- Below will go to either the start or the end, whichever is closer.
         -- Use if you want more granular movements
         -- Make it even more gradual by adding multiple queries and regex.
         goto_next = {
            ["]i"] = "@conditional.outer",
         },
         goto_previous = {
            ["[i"] = "@conditional.outer",
         }
      },

      swap = {
         enable = true,
         swap_next = {
            [">,"] = "@parameter.inner",
         },
         swap_previous = {
            ["<,"] = "@parameter.inner",
         },
      },


      lsp_interop = {
         enable = true,
         border = 'none',
         floating_preview_opts = {},
         peek_definition_code = {
            ["<leader>df"] = "@function.outer",
            ["<leader>dF"] = "@class.outer",
         },
      },
   },


   playground = {
      enable = true,
      disable = {},
      updatetime = 25, -- Debounced time for highlighting nodes in the playground from source code
      persist_queries = false, -- Whether the query persists across vim sessions
      keybindings = {
         toggle_query_editor = 'o',
         toggle_hl_groups = 'i',
         toggle_injected_languages = 't',
         toggle_anonymous_nodes = 'a',
         toggle_language_display = 'I',
         focus_language = 'f',
         unfocus_language = 'F',
         update = 'R',
         goto_node = '<cr>',
         show_help = '?',
      },
   },

   query_linter = {
      enable = true,
      use_virtual_text = true,
      lint_events = {"BufWrite", "CursorHold"},
   },
}

local group = vim.api.nvim_create_augroup("TreesitterAutogroup", {
   clear = true
})

for _, lang in ipairs(langs) do
   vim.api.nvim_create_autocmd({ 'FileType' }, {
      group = group,
      pattern = lang,
      callback = function()
         vim.opt_local.foldmethod = "expr"
         vim.opt_local.foldexpr = "nvim_treesitter#foldexpr()"
      end,
   })
end


vim.keymap.set({ "n", "x", "o" }, ";", ts_repeat_move.repeat_last_move)
vim.keymap.set({ "n", "x", "o" }, ",", ts_repeat_move.repeat_last_move_opposite)
vim.keymap.set({ "n", "x", "o" }, "f", ts_repeat_move.builtin_f)
vim.keymap.set({ "n", "x", "o" }, "F", ts_repeat_move.builtin_F)
vim.keymap.set({ "n", "x", "o" }, "t", ts_repeat_move.builtin_t)
vim.keymap.set({ "n", "x", "o" }, "T", ts_repeat_move.builtin_T)
