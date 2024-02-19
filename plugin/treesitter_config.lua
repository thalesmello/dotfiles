if vim.fn.match(vim.opt.runtimepath:get(), "nvim-treesitter") == -1 then
   return
end

local langs = {"lua", "vim", "python", "ruby"}

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
            ["ac"] = "@class.outer",
            -- You can optionally set descriptions to the mappings (used in the desc parameter of
            -- nvim_buf_set_keymap) which plugins like which-key display
            ["ic"] = { query = "@class.inner", desc = "Select inner part of a class region" },
            -- You can also use captures from other query groups like `locals.scm`
            ["as"] = { query = "@scope", query_group = "locals", desc = "Select language scope" },
         },

         selection_modes = {
            ['@parameter.outer'] = 'v', -- charwise
            ['@function.outer'] = 'V', -- linewise
            ['@class.outer'] = '<c-v>', -- blockwise
         },
         move = {
            enable = true,
            set_jumps = true, -- whether to set jumps in the jumplist
            goto_next_start = {
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
               ["]d"] = "@conditional.outer",
            },
            goto_previous = {
               ["[d"] = "@conditional.outer",
            }
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

