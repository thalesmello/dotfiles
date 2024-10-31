return {
    'neovim/nvim-lspconfig',
    event = { "BufReadPost", "BufNewFile", "BufFilePost" },
    config = function ()
        require('config/lsp')
    end,
    dependencies = {
        { 'folke/neodev.nvim' },
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
        },
        {
            'williamboman/mason.nvim',
            dependencies = {
                'williamboman/mason-lspconfig.nvim',
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
        { "ray-x/lsp_signature.nvim" },
        {
            'dcampos/nvim-snippy',
            keys = {
                {"<leader>esp", function()
                    local config = vim.fn.stdpath("config")
                    if vim.fn.expand("%:e") == '' then
                        return
                    end

                    vim.cmd.edit(config .. "/snippets/" .. vim.fn.expand("%:e") .. '.snippets')
                    vim.bo.filetype = "snippets"
                end}
            },
            dependencies = {
                { 'dcampos/cmp-snippy' },
                { 'rafamadriz/friendly-snippets' },
                { 'honza/vim-snippets' },
            },
        },
    },
}
