return {

   {
      'williamboman/mason.nvim',
      lazy = true,
      cmd = { "Mason", "MasonInstall", "MasonUpdate", "MasonUninstall", "MasonUninstallAll", "MasonLog" },
      init = function()
         local mason_bin = vim.fn.stdpath("data") .. "/mason/bin"
         if not (vim.env.PATH or ""):find(mason_bin, 1, true) then
            vim.env.PATH = mason_bin .. ":" .. (vim.env.PATH or "")
         end
      end,
      opts = {},
   },
   {
      'williamboman/mason-lspconfig.nvim',
      lazy = true,
      dependencies = { 'williamboman/mason.nvim', 'neovim/nvim-lspconfig' },
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
            on_attach = function(client, bufnr)
               -- Only Hammerspoon buffers need EmmyLua; never load the Spoon
               -- during Hammerspoon startup or for unrelated Lua projects.
               local file = vim.uv.fs_realpath(vim.api.nvim_buf_get_name(bufnr)) or ""
               local home = vim.env.HOME
               local function inside(dir)
                  dir = vim.uv.fs_realpath(dir)
                  return dir and file:sub(1, #dir + 1) == dir .. "/"
               end
               if inside(home .. "/.hammerspoon") or inside(home .. "/.local_dotfiles/hammerspoon") then
                  if not vim.g.hammerspoon_annotations_requested then
                     vim.g.hammerspoon_annotations_requested = true
                     vim.system({vim.v.progpath, "--headless", "-u", "NONE", "-l", home .. "/src/dotfiles/scripts/hammerspoon-lsp-annotations.lua"}, {timeout = 5000}, function(result)
                        vim.schedule(function()
                           if result.code ~= 0 then
                              vim.g.hammerspoon_annotations_requested = nil
                              vim.notify("Hammerspoon LSP annotations: " .. (result.stderr or "generation failed"), vim.log.levels.WARN)
                              return
                           end
                           -- Also covers the first LSP attach on a clean install,
                           -- where the annotation directory did not exist yet.
                           if client:is_stopped() then return end
                           local settings = client.config.settings
                           settings.Lua.workspace.library[#settings.Lua.workspace.library + 1] = home .. "/.hammerspoon/Spoons/EmmyLua.spoon/annotations"
                           client:notify("workspace/didChangeConfiguration", {settings = settings})
                        end)
                     end)
                  end
               end
            end,
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
