-- note: diagnostics are not exclusive to lsp servers
-- so these can be global keybindings
local cmp = require('cmp')
local cmp_lsp = require('cmp_nvim_lsp')
local snippy = require('snippy')

vim.keymap.set('n', 'gl', '<cmd>lua vim.diagnostic.open_float()<cr>')
vim.keymap.set('n', '[g', '<cmd>lua vim.diagnostic.goto_prev()<cr>')
vim.keymap.set('n', ']g', '<cmd>lua vim.diagnostic.goto_next()<cr>')

vim.api.nvim_create_autocmd('LspAttach', {
  desc = 'LSP actions',
  callback = function(event)
    local opts = {buffer = event.buf}

    -- these will be buffer-local keybindings
    -- because they only work if you have an active language server

    vim.keymap.set('n', 'K', '<cmd>lua vim.lsp.buf.hover()<cr>', opts)
    vim.keymap.set('n', 'gd', '<cmd>lua vim.lsp.buf.definition()<cr>', opts)
    vim.keymap.set('n', 'gD', '<cmd>lua vim.lsp.buf.declaration()<cr>', opts)
    vim.keymap.set('n', 'gi', '<cmd>lua vim.lsp.buf.implementation()<cr>', opts)
    vim.keymap.set('n', 'go', '<cmd>lua vim.lsp.buf.type_definition()<cr>', opts)
    vim.keymap.set('n', 'gr', '<cmd>lua vim.lsp.buf.references()<cr>', opts)
    vim.keymap.set('n', 'gK', '<cmd>lua vim.lsp.buf.signature_help()<cr>', opts)
    vim.keymap.set('n', 'gr', '<cmd>lua vim.lsp.buf.rename()<cr>', opts)
    vim.keymap.set({'n', 'x'}, 'g%', '<cmd>lua vim.lsp.buf.format({async = true})<cr>', opts)
    vim.keymap.set('n', '<leader>.', '<cmd>lua vim.lsp.buf.code_action()<cr>', opts)
  end
})

local lsp_capabilities = cmp_lsp.default_capabilities()

local default_setup = function(server)
  require('lspconfig')[server].setup({
    capabilities = lsp_capabilities,
  })
end


local has_words_before = function()
  unpack = unpack or table.unpack
  local line, col = unpack(vim.api.nvim_win_get_cursor(0))
  return col ~= 0 and vim.api.nvim_buf_get_lines(0, line - 1, line, true)[1]:sub(col, col):match("%s") == nil
end

require('mason').setup({})
require('mason-lspconfig').setup({
    ensure_installed = {},
    handlers = {
        default_setup,
        lua_ls = function()
            require('lspconfig').lua_ls.setup({
                capabilities = lsp_capabilities,
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
})

cmp.setup({
    sources = {
        {name = 'nvim_lsp'},
        {name = 'snippy'},
    },

    mapping = cmp.mapping.preset.insert({
        -- Enter key confirms completion item
        -- ['<tab>'] = cmp.mapping.confirm({select = false}),

        -- Ctrl + space triggers completion menu
        ['<C-Space>'] = cmp.mapping.complete(),
        ["<Tab>"] = cmp.mapping(function(fallback)
            if cmp.visible() then
                cmp.select_next_item()
            elseif snippy.can_expand_or_advance() then
                snippy.expand_or_advance()
            elseif has_words_before() then
                cmp.complete()
            else
                fallback()
            end
        end, { "i", "s" }),

        ["<S-Tab>"] = cmp.mapping(function()
            if cmp.visible() then
                cmp.select_prev_item()
            elseif snippy.can_jump(-1) then
                snippy.previous()
            else
                vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes('<backspace>', true, false, true), vim.fn.mode(), true)
            end
        end, { "i", "s" }),

        -- ['<cr>'] = cmp.mapping(function ()
        --     if cmp.visible() and vim.fn.complete_info()["selected"] == -1 then
        --         vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes('<c-g>u<cr>', true, false, true), vim.fn.mode(), true)
        --     else
        --         vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes('<c-y>', true, false, true), vim.fn.mode(), true)
        --     end
        -- end, { "i", "s" })
    }),

    snippet = {
        expand = function(args)
            snippy.expand_snippet(args.body)
        end,
    },
})

vim.keymap.set({ 'i', 's' }, '<c-l>', function()
    if snippy.can_expand_or_advance() then
        return '<plug>(snippy-expand-or-advance)'
    else
        return '<c-l>'
    end
end, { expr = true })

vim.keymap.set({ 'i', 's' }, '<c-h>', function()
    if snippy.can_jump(-1) then
        return '<plug>(snippy-previous)'
    else
        return '<c-h>'
    end
end, { expr = true })

vim.keymap.set('x', '<Tab>', function ()
    -- '<plug>(snippy-cut-text)'
    snippy.cut_text(vim.fn.mode(), true)
end)
-- map( 'n', 'g<Tab>', '<plug>(snippy-cut-text)')
