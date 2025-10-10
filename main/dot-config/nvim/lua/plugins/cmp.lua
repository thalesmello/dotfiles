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

            -- view = {
            --    entries = "native",
            -- },

            formatting = {
               format = function(entry, vim_item)
                  vim_item.kind = string.format('%s %s', style_cmp.kind_icons[vim_item.kind], vim_item.kind) -- This concatenates the icons with the name of the item kind
                  vim_item.menu = string.format("[%s]", entry.source.name)
                  return vim_item
               end
            },
         })
      end,
      extra_contexts = {"firenvim", "lite_mode"},
   },
   vim_utils.injector_module({
      "thalesmello/cmp-rg",
      injectable_opts = {
         "hrsh7th/nvim-cmp",
         merge_opts = function()
            if (vim.fn.getcwd() ~= vim.fn.expand('~')) then
               return { sources = { { name = 'rg' } } }
            end
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
      },
      extra_contexts = {"lite_mode"}
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
      },
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
      },
      extra_contexts = {"lite_mode"},
   }),
   vim_utils.injector_module({
      'hrsh7th/cmp-buffer',
      injectable_opts = {
         "hrsh7th/nvim-cmp",
         merge_opts = {
            sources = {
               {
                  name = 'buffer',
                  option = {
                     get_bufnrs = function()
                        return vim.api.nvim_list_bufs()
                     end,
                  }
               },
            }
         },
      },
      extra_contexts = {"lite_mode"},
   }),
   vim_utils.injector_module({
      {
         "folke/lazydev.nvim",
         enabled = false,
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
   }),
   {
      'hrsh7th/cmp-cmdline',
      dependencies = {'hrsh7th/nvim-cmp'},
      config = function ()
         local cmp = require('cmp')

         local cmdMoved = true

         local function string_difference(old, new)
            for i = 1,#new do --Loop over strings
               if new:sub(i,i) ~= old:sub(i,i) then --If that character is not equal to it's counterpart
                  return i --Return that index
               end
            end
            return #new+1 --Return the index after where the shorter one ends as fallback.
         end

         vim.api.nvim_create_autocmd({ 'CmdlineEnter' }, {
            group = vim.api.nvim_create_augroup('CmpCmdlineGroup', { clear = true }),
            pattern = "*",
            callback = function()
               cmdMoved = false
               local lastcmdline = ""

               local cmdChangedGroup = vim.api.nvim_create_augroup('CmpCmdlineChangedGroup', { clear = true })
               vim.api.nvim_create_autocmd({ 'CmdlineChanged' }, {
                  group = cmdChangedGroup,
                  pattern = "*",
                  callback = function()
                     local cmdline = vim.fn.getcmdline()
                     local diff_index = string_difference(lastcmdline, cmdline)

                     if #cmdline > #lastcmdline and #lastcmdline > 0 and diff_index == #cmdline then
                        cmdMoved = true
                        vim.api.nvim_clear_autocmds({ group = cmdChangedGroup })
                        return
                     end

                     lastcmdline = cmdline
                  end,
               })
            end,
         })


         local cmdconfig
         cmdconfig = {
            mapping = cmp.mapping.preset.cmdline({
               ['<C-n>'] = cmp.mapping(
                  function(fallback)
                     if cmdMoved and cmp.visible() then
                        cmp.select_next_item()
                     else
                        fallback()
                     end
                  end, {"c"}
               ),
               ['<C-p>'] = cmp.mapping(
                  function(fallback)
                     if cmdMoved and cmp.visible() then
                        cmp.select_prev_item()
                     else
                        fallback()
                     end
                  end, {"c"}
               ),
               ['<Tab>'] = cmp.mapping(
                  function()
                     if cmp.visible() then
                        cmp.select_next_item()
                     else
                        cmp.complete({
                           config = vim.tbl_deep_extend('force', cmdconfig or {}, {
                              sources = cmp.config.sources(
                                 { { name = 'path' } },
                                 { { name = 'cmdline' } }
                              )
                           })
                        })
                     end
                  end, {"c"}
               ),
               ['<CR>'] = cmp.mapping(
                  function(fallback)
                     if cmp.visible() and cmp.get_selected_entry() ~= nil then
                        cmp.confirm({ select = false })
                     else
                        fallback()
                     end
                  end, {"c"}
               ),
            }),
            sources = cmp.config.sources(
               {
                  { name = 'path' },
               },
               {
                  {
                     name = 'cmdline',
                     option = {
                        ignore_cmds = { 'Man',  'read!', 'r!', '!', 'Shdo', 'Fish', 'Ag', 'Ag!' }
                     }
                  },
               }
            ),
            view = {
               entries = "custom",
            },
         }
         -- `:` cmdline setup.
         cmp.setup.cmdline(':', cmdconfig)

         -- `/` cmdline setup.
         cmp.setup.cmdline('/', {
            completion = {
               autocomplete = false,
            },
            mapping = cmp.mapping.preset.cmdline({
               ['<C-n>'] = cmp.mapping(
                  function(fallback) fallback() end, {"c"}
               ),
               ['<C-p>'] = cmp.mapping(
                  function(fallback) fallback() end, {"c"}
               ),
            }),
            sources = {
               { name = 'buffer' },
            },
            view = {
               entries = "custom",
            }
         })
      end,
      extra_contexts = {"firenvim"}
   },
}
