return {
    {
        'neovim/nvim-lspconfig',
        event = { "BufReadPost", "BufNewFile", "BufFilePost" },
        extra_contexts = {"ssh"},
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
    {
        "ray-x/lsp_signature.nvim",
        extra_contexts = {"ssh"},
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
        },
        config = function (_, opts)
            vim.api.nvim_create_autocmd('LspAttach', {
                desc = 'LspSignatureGroup',
                group = vim.api.nvim_create_augroup("LspSignatureGroup", { clear = true}),
                callback = function(event)
                    local buf = event.buf
                    local client = vim.lsp.get_client_by_id(event.data.client_id)

                    -- Ignore events servers known to be problematic
                    if client == nil or vim.list_contains({"fish_lsp"}, client.name) then
                        return
                    end

                    require "lsp_signature".on_attach(opts, buf)
                end
            })
        end
    },
    {
        'ii14/lsp-command',
        init = function ()
            vim.g.lsp_legacy_commands = true
        end,
        dependencies = {
            { "neovim/nvim-lspconfig" },
        },
        extra_contexts = {"ssh"},
    },
}
