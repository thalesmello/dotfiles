return {
    {
        'neovim/nvim-lspconfig',
        event = { "BufReadPost", "BufNewFile", "BufFilePost" },
        config = function ()
            -- note: diagnostics are not exclusive to lsp servers
            -- so these can be global keybindings

            vim.keymap.set('n', 'gl', '<cmd>lua vim.diagnostic.open_float()<cr>')
            vim.keymap.set('n', '[g', '<cmd>lua vim.diagnostic.goto_prev()<cr>')
            vim.keymap.set('n', ']g', '<cmd>lua vim.diagnostic.goto_next()<cr>')


            local group = vim.api.nvim_create_augroup("LspAuGroup", { clear = true})

            vim.api.nvim_create_autocmd('LspAttach', {
                desc = 'LSP actions',
                group = group,
                callback = function(event)
                    local opts = { buffer = event.buf }
                    local client = vim.lsp.get_client_by_id(event.data.client_id)

                    -- these will be buffer-local keybindings
                    -- because they only work if you have an active language server
                    if client == nil then
                        return
                    end

                    local capabilities = client.server_capabilities

                    local  mapCapability = function(cond, mode, key, cmd)
                        if cond then
                            vim.keymap.set(mode, key, cmd, opts)
                        end
                    end

                    mapCapability(capabilities.hoverProvider, 'n', 'K', '<cmd>lua vim.lsp.buf.hover()<cr>')
                    vim.opt_local.tagfunc = "v:lua.vim.lsp.tagfunc"
                    mapCapability(capabilities.declarationProvider, 'n', 'gd', '<cmd>lua vim.lsp.buf.declaration()<cr>')
                    mapCapability(capabilities.implementationProvider, 'n', 'gI', '<cmd>lua vim.lsp.buf.implementation()<cr>')
                    mapCapability(capabilities.typeDefinitionProvider, 'n', 'go', '<cmd>lua vim.lsp.buf.type_definition()<cr>')
                    mapCapability(capabilities.referencesProvider, 'n', 'gr', '<cmd>lua vim.lsp.buf.references()<cr>')
                    mapCapability(capabilities.signatureHelpProvider, 'n', 'gK', '<cmd>lua vim.lsp.buf.signature_help()<cr>')
                    mapCapability(capabilities.renameProvider, 'n', 'gr', '<cmd>lua vim.lsp.buf.rename()<cr>')
                    mapCapability(capabilities.documentFormattingProvider, { 'n', 'x' }, 'g%', '<cmd>lua vim.lsp.buf.format({async = true})<cr>')
                    mapCapability(capabilities.codeActionProvider, 'n', '<leader>.', '<cmd>lua vim.lsp.buf.code_action()<cr>')
                end
            })
        end,
        dependencies = {
            { 'nvim-cmp' },
            { 'dcampos/nvim-snippy' },
        },
    },
    {
        'hrsh7th/nvim-cmp',
        dependencies = {
            {'hrsh7th/cmp-nvim-lsp'},
            {'hrsh7th/cmp-buffer'},
            {'hrsh7th/cmp-path'},
            {'hrsh7th/cmp-cmdline'},
            {'thalesmello/cmp-rg'},
            {'hrsh7th/cmp-calc'},
        },
        opts = function ()
            local cmp = require('cmp')
            local snippy = require('snippy')
            local vim_utils = require('vim_utils')
            local kind_icons = {
                Text = "",
                Method = "󰆧",
                Function = "󰊕",
                Constructor = "",
                Field = "󰇽",
                Variable = "󰂡",
                Class = "󰠱",
                Interface = "",
                Module = "",
                Property = "󰜢",
                Unit = "",
                Value = "󰎠",
                Enum = "",
                Keyword = "󰌋",
                Snippet = "",
                Color = "󰏘",
                File = "󰈙",
                Reference = "",
                Folder = "󰉋",
                EnumMember = "",
                Constant = "󰏿",
                Struct = "",
                Event = "",
                Operator = "󰆕",
                TypeParameter = "󰅲",
            }

            return {
                sources = {
                    { name = 'nvim_lsp' },
                    { name = 'snippy' },
                    {
                        name = 'buffer',
                        get_bufnrs = function()
                            return vim.api.nvim_list_bufs()
                        end,
                    },
                    { name = 'path' },
                    { name = 'calc' },
                    {
                        name = "rg",
                        -- Try it when you feel cmp performance is poor
                        -- keyword_length = 3
                    },
                },

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
                        elseif snippy.can_expand_or_advance() then
                            snippy.expand_or_advance()


                            -- Removing because copilot is not being used anymore
                            -- elseif has_words_before() then
                            -- vim.fn.feedkeys(vim.fn["copilot#Accept"](), "n")

                            -- -- Function used with copilot TODO: Move to vim_utils
                            -- local has_words_before = function()
                            --     unpack = unpack or table.unpack
                            --     local line, col = unpack(vim.api.nvim_win_get_cursor(0))
                            --     return col ~= 0 and vim.api.nvim_buf_get_lines(0, line - 1, line, true)[1]:sub(col, col):match("%s") == nil
                            -- end
                        else
                            fallback()
                        end
                    end, { "i", "s" }),

                    ["<S-Tab>"] = cmp.mapping(function()
                        if cmp.visible() then
                            cmp.select_prev_item({ behavior = cmp.SelectBehavior.Select })
                        elseif snippy.can_jump(-1) then
                            snippy.previous()
                        else
                            vim_utils.feedkeys('<backspace>')
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

                snippet = {
                    expand = function(args)
                        snippy.expand_snippet(args.body)
                    end,
                },

                view = {
                    entries = "native",
                },

                formatting = {
                    format = function(entry, vim_item)
                        vim_item.kind = string.format('%s %s', kind_icons[vim_item.kind], vim_item.kind) -- This concatenates the icons with the name of the item kind
                        vim_item.menu = string.format("[%s]", entry.source.name)
                        return vim_item
                    end
                },
            }
        end,
        config = function (_, opts)
            local cmp = require('cmp')

            cmp.setup(opts)

            -- `/` cmdline setup.
            cmp.setup.cmdline('/', {
                mapping = cmp.mapping.preset.cmdline(),
                sources = {
                    { name = 'buffer' },
                },
                view = {
                    entries = "custom",
                }
            })

            -- `:` cmdline setup.
            cmp.setup.cmdline(':', {
                mapping = cmp.mapping.preset.cmdline(),
                sources = cmp.config.sources(
                    {
                        { name = 'path' },
                    },
                    {
                        {
                            name = 'cmdline',
                            option = {
                                ignore_cmds = { 'Man', '!', 'Shdo' }
                            }
                        },
                    }),
                view = {
                    entries = "custom",
                }
            })

        end
    },

    {
        'dcampos/nvim-snippy',
        keys = {
            {
                "<leader>esp",
                function()
                    local config = vim.fn.stdpath("config")
                    if vim.fn.expand("%:e") == '' then
                        return
                    end

                    vim.cmd.edit(config .. "/snippets/" .. vim.fn.expand("%:e") .. '.snippets')
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
            { 'dcampos/cmp-snippy' },
            { 'honza/vim-snippets' },
        },
        lazy = false,
    },
    {
        'williamboman/mason.nvim',
        opts = {},
        dependencies = {
            {
                "rshkarin/mason-nvim-lint",
                dependencies = {
                    "mfussenegger/nvim-lint",
                    config = function()
                        require('lint').linters_by_ft = {
                            python = { 'flake8' }
                        }

                        local group = vim.api.nvim_create_augroup("LintGroup", { clear = true })

                        vim.api.nvim_create_autocmd({ "BufEnter" }, {
                            group = group,
                            callback = function() require("lint").try_lint() end,
                        })

                        vim.api.nvim_create_autocmd({ "BufWritePost" }, {
                            group = group,
                            callback = function() require("lint").try_lint() end,
                        })
                    end

                },
                opts = {}
            },
            {
                'mhartington/formatter.nvim',
                config = function()
                    local util = require "formatter.util"

                    require("formatter").setup {
                        logging = true,
                        log_level = vim.log.levels.WARN,

                        filetype = {
                            lua = {
                                require("formatter.filetypes.lua").stylua,
                            },

                            python = {
                                require("formatter.filetypes.python").black,
                            },

                            ["*"] = {
                                require("formatter.filetypes.any").remove_trailing_whitespace,
                            }
                        }
                    }
                end

            }
        },
    },
    {
        'williamboman/mason-lspconfig.nvim',
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
                ensure_installed = {},
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
    {
        "ray-x/lsp_signature.nvim",
        opts = {
            hint_enable = false,
            handler_opts = { border = "single" },
            max_width = 80,
        }
    },
    {
        {
            "folke/lazydev.nvim",
            ft = "lua", -- only load on lua files
            opts = {
                library = {
                    -- See the configuration section for more details
                    -- Load luvit types when the `vim.uv` word is found
                    { path = "luvit-meta/library", words = { "vim%.uv" } },
                },
            },
        },
        { "Bilal2453/luvit-meta", lazy = true }, -- optional `vim.uv` typings
        { -- optional cmp completion source for require statements and module annotations
            "hrsh7th/nvim-cmp",
            opts = function(_, opts)
                opts.sources = opts.sources or {}
                table.insert(opts.sources, {
                    name = "lazydev",
                    group_index = 0, -- set group index to 0 to skip loading LuaLS completions
                })
            end,
        }
    }
}
