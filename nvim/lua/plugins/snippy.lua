local vim_utils = require "vim_utils"

return {
   vim_utils.injector_module({
      'dcampos/nvim-snippy',
      keys = {
         {
            "<leader>esp",
            function()
               local config = vim.fn.stdpath("config")
               local filetype = vim.o.filetype
               if filetype == '' then
                  return
               end

               vim.cmd.edit(config .. "/snippets/" .. filetype .. '.snippets')
               vim.bo.filetype = "snippets"
            end
         },
         {
            '<c-l>',
            function()
               if require('snippy').can_expand_or_advance() then
                  return '<plug>(snippy-expand-or-advance)'
               else
                  return '<c-l>'
               end
            end,
            expr = true,
            mode={ 'i', 's' },
         },

         {
            '<c-h>',
            function()
               if require('snippy').can_jump(-1) then
                  return '<plug>(snippy-previous)'
               else
                  return '<c-h>'
               end
            end,
            expr = true , mode = { 'i', 's' }
         },

         {
            '<Tab>',
            function()
               require('snippy').cut_text(vim.fn.mode(), true)
            end,
            mode = 'x'
         },
         {'g<Tab>', '<plug>(snippy-cut-text)', mode = 'n' }
      },
      opts = {},
      dependencies = {
         { 'honza/vim-snippets' },
      },
      lazy = false,
      injectable_opts = {
         {
            'hrsh7th/nvim-cmp',
            dependencies = {
               { 'dcampos/cmp-snippy' },
            },
            opts = function (_, opts)
               local snippy = require('snippy')

               return vim.tbl_deep_extend("force", opts, {
                  snippet = {
                     expand = function(args)
                        snippy.expand_snippet(args.body)
                     end,
                  },
                  sources = vim.list_extend(opts.sources or {}, {
                     { name = 'snippy' },
                  })
               })
            end
         }
      },
      extra_contexts = {"firenvim"},
   }),
}
