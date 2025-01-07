local vim_utils = require("vim_utils")

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

                    if capabilities == nil then
                        return
                    end

                    local  mapCapability = function(cond, mode, key, cmd)
                        if cond then
                            vim.keymap.set(mode, key, cmd, opts)
                        end
                    end

                    mapCapability(capabilities.hoverProvider, 'n', 'K', '<cmd>lua vim.lsp.buf.hover()<cr>')
                    vim.opt_local.tagfunc = "v:lua.vim.lsp.tagfunc"
                    mapCapability(capabilities.declarationProvider, 'n', 'gD', '<cmd>lua vim.lsp.buf.declaration()<cr>')
                    mapCapability(capabilities.implementationProvider, 'n', 'gI', '<cmd>lua vim.lsp.buf.implementation()<cr>')
                    mapCapability(capabilities.typeDefinitionProvider, 'n', '<leader>go', '<cmd>lua vim.lsp.buf.type_definition()<cr>')
                    mapCapability(capabilities.referencesProvider, 'n', '<leader>fr', '<cmd>lua vim.lsp.buf.references()<cr>')
                    mapCapability(capabilities.signatureHelpProvider, 'n', 'gK', '<cmd>lua vim.lsp.buf.signature_help()<cr>')
                    mapCapability(capabilities.renameProvider, 'n', '<leader>rv', '<cmd>lua vim.lsp.buf.rename()<cr>')
                    mapCapability(capabilities.codeActionProvider, 'n', '<leader>.', '<cmd>lua vim.lsp.buf.code_action()<cr>')
                end
            })
        end,
    },
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
        "thalesmello/cmp-rg",
        injectable_opts = {
            "hrsh7th/nvim-cmp",
            merge_opts = function(_, opts)
                if vim.fn.getcwd() ~= vim.fn.expand('~') then
                    return {
                        sources = { { name = 'rg' } },
                    }
                end
            end,
        },
        extra_contexts = {"firenvim"},
    }),
    {
        'hrsh7th/nvim-cmp',
        opts = function (_, opts)
            local cmp = require('cmp')
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
                        vim_item.kind = string.format('%s %s', kind_icons[vim_item.kind], vim_item.kind) -- This concatenates the icons with the name of the item kind
                        vim_item.menu = string.format("[%s]", entry.source.name)
                        return vim_item
                    end
                },
            })
        end,
        extra_contexts = {"firenvim"},
    },
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


            -- `:` cmdline setup.
            cmp.setup.cmdline(':', {
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
                }),
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
                    }
                ),
                view = {
                    entries = "custom",
                },
            })

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
    {
        "ray-x/lsp_signature.nvim",
        opts = {
            hint_enable = true,
            handler_opts = { border = "single" },
            hint_prefix = {
                above = "↙ ",  -- when the hint is on the line above the current line
                current = "← ",  -- when the hint is on the same line
                below = "↖ "  -- when the hint is on the line below the current line
            },
            -- max_width = 80,
            toggle_key = "<c-/>",
            toggle_key_flip_floatwin_setting = true,
        }
    },
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
    }),
    {
        'ii14/lsp-command',
        init = function ()
            vim.g.lsp_legacy_commands = true
        end,
        dependencies = {
            { "neovim/nvim-lspconfig" },
        }
    },
}
