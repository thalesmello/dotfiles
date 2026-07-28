return {

   {
      'williamboman/mason.nvim',
      opts = {},
   },
   {
      'williamboman/mason-lspconfig.nvim',
      dependencies = { 'williamboman/mason.nvim' },
      opts = {
         ensure_installed = {
            "jsonls",
            "lua_ls",
            "fish_lsp",
         },
      },

      config = function (_, opts)
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

         vim.lsp.config('lua_ls', {
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

         -- local fish_lsp_caps = vim.lsp.protocol.make_client_capabilities()
         --
         -- fish_lsp_caps.textDocument.signatureHelp = nil

         require("mason-lspconfig").setup(opts)
      end
   },
}
