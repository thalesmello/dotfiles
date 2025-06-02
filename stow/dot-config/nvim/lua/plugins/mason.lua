return {

   {
      'williamboman/mason.nvim',
      version = "^1.0.0",
      opts = {},
   },
   {
      'williamboman/mason-lspconfig.nvim',
      version = "^1.0.0",
      dependencies = { 'williamboman/mason.nvim' },
      opts = function ()
         local capabilities = require('cmp_nvim_lsp').default_capabilities()
         local lspconfig = require('lspconfig')

         -- local configs = require 'lspconfig.configs'
         -- local lspconfig_util = require("lspconfig.util")

         -- -- This is a Tentative DBT configuration.
         -- -- Looks promising, but doesn't work very well just yet so it's commented out,
         -- -- I'm keeping it around for when I have time to fix it.
         -- -- Known bugs:
         -- -- - tries to find a literal '/target' folder, but file doesn't exist. Should find the project's target folder instead.
         -- -- - thinks a source doesn't exist as a table, when in fact it's a view
         -- if not configs.dbt_ls then
         --     configs.dbt_ls = {
         --         default_config = {
         --             -- capabilities = lsp_capabilities,
         --             -- Install with: npm install -g @fivetrandevelopers/dbt-language-server@0.33.2
         --             cmd = { 'dbt-language-server', '--stdio', },
         --             -- cmd = { 'npm', 'exec', '@fivetrandevelopers/dbt-language-server@0.33.1', '--', '--stdio', },
         --             root_dir = lspconfig_util.root_pattern("dbt_project.yml", "dbt_project.yaml"),
         --             filetypes = { "sql", "yml" },
         --             name = 'dbt_ls',
         --         },
         --     }
         -- end

         -- lspconfig.dbt_ls.setup {
         --     init_options = {
         --         pythonInfo = {
         --             path = "/Users/thales.mello/.local/pipx/venvs/dbt-core/bin/python3",
         --         },
         --         lspMode = "dbtProject",
         --         enableSnowflakeSyntaxCheck = false,
         --     },
         -- }


         local default_setup = function(server)
            lspconfig[server].setup({
               capabilities = capabilities,
            })
         end

         return {
            ensure_installed = {
               "jsonls",
               "lua_ls",
            },
            handlers = {
               default_setup,
               lua_ls = function()
                  lspconfig.lua_ls.setup({
                     capabilities = capabilities,
                     settings = {
                        Lua = {
                           runtime = {
                              version = 'LuaJIT'
                           },
                           diagnostics = {
                              globals = { 'vim' },
                           },
                           workspace = {
                              library = {
                                 vim.env.VIMRUNTIME,
                              }
                           }
                        }
                     }
                  })
               end
            },
         }
      end
   },
}
