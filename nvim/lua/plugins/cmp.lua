local vim_utils = require("vim_utils")
local style_cmp = require("style.cmp")

return {
   {
      'hrsh7th/nvim-cmp',
      opts = function (_, opts)
         local cmp = require('cmp')

         return vim.tbl_deep_extend('force', opts, {
            mapping = cmp.mapping.preset.insert({
               -- Enter key confirms completion item
               -- ['<tab>'] = cmp.mapping.confirm({select = false}),

               -- Ctrl + space triggers completion menu
               ['<C-u>'] = cmp.mapping.scroll_docs(-4),
               ['<C-d>'] = cmp.mapping.scroll_docs(4),
               ['<C-Space>'] = cmp.mapping.complete(),
               ["<Tab>"] = cmp.mapping(function(fallback)
                  if cmp.visible() then
                     cmp.select_next_item({ behavior = cmp.SelectBehavior.Select })
                     -- Removing because copilot is not being used anymore
                     -- elseif has_words_before() then
                     -- vim.fn.feedkeys(vim.fn["copilot#Accept"](), "n")

                     -- -- Function used with copilot TODO: Move to vim_utils
                  else
                     fallback()
                  end
               end, { "i", "s" }),

               ["<S-Tab>"] = cmp.mapping(function(fallback)
                  if cmp.visible() then
                     cmp.select_prev_item({ behavior = cmp.SelectBehavior.Select })
                  else
                     fallback()
                  end
               end, { "i", "s" }),

               ['<cr>'] = cmp.mapping(function(fallback)
                  if (not cmp.visible()) or (cmp.visible() and cmp.get_selected_entry() == nil) then
                     vim_utils.feedkeys('<c-g>u')
                     fallback()
                  else
                     cmp.confirm({ select = false })
                  end
               end, { "i", "s" })
            }),

            view = {
               entries = "native",
            },

            formatting = {
               format = function(entry, vim_item)
                  vim_item.kind = string.format('%s %s', style_cmp.kind_icons[vim_item.kind], vim_item.kind) -- This concatenates the icons with the name of the item kind
                  vim_item.menu = string.format("[%s]", entry.source.name)
                  return vim_item
               end
            },
         })
      end,
      extra_contexts = {"firenvim"},
   },
   vim_utils.injector_module({
      "thalesmello/cmp-rg",
      injectable_opts = {
         "hrsh7th/nvim-cmp",
         merge_opts = function()
            return (vim.fn.getcwd() ~= vim.fn.expand('~')) and { sources = { { name = 'rg' } } }
         end,
      },
      extra_contexts = {"firenvim"},
   }),
   vim_utils.injector_module({
      'hrsh7th/cmp-path',
      injectable_opts = {
         "hrsh7th/nvim-cmp",
         merge_opts = {
            sources = {
               { name = 'path' },
            }
         },
      }
   }),
   vim_utils.injector_module({
      'hrsh7th/cmp-nvim-lsp',
      injectable_opts = {
         "hrsh7th/nvim-cmp",
         merge_opts = {
            sources = {
               { name = 'nvim_lsp' },
            }
         },
      }
   }),
   vim_utils.injector_module({
      'hrsh7th/cmp-calc',
      injectable_opts = {
         "hrsh7th/nvim-cmp",
         merge_opts = {
            sources = {
               { name = 'calc' },
            }
         },
      }
   }),
   vim_utils.injector_module({
      'hrsh7th/cmp-buffer',
      injectable_opts = {
         "hrsh7th/nvim-cmp",
         merge_opts = {
            sources = {
               {
                  name = 'buffer',
                  get_bufnrs = function()
                     return vim.api.nvim_list_bufs()
                  end,
               },
            }
         },
      }
   }),
   vim_utils.injector_module({
      {
         "folke/lazydev.nvim",
         ft = "lua", -- only load on lua files
         dependencies = { "Bilal2453/luvit-meta" },
         opts = {
            library = {
               { path = "luvit-meta/library", words = { "vim%.uv" } },
            },
         },
         injectable_opts = {
            {
               "hrsh7th/nvim-cmp",
               merge_opts = {
                  sources = { { name = "lazydev", group_index = 0 } },
               },
            }
         }
      },
   })
}
