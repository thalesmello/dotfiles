return {
   {
        'mhartington/formatter.nvim',
        cmd = { "Format", "FormatWrite" },
        opts = function ()
            local filetype = {
                lua = {
                    require("formatter.filetypes.lua").stylua,
                },

                python = {
                    require("formatter.filetypes.python").black,
                },

                sql = {
                    function ()
                        return {
                            exe = "sqlfmt",
                            args = {
                                "-",
                            },
                            stdin = true,
                        }
                    end
                },

                ["*"] = {
                    require("formatter.filetypes.any").remove_trailing_whitespace,
                }
            }

            if type(vim.g.formatter_filetype_overrides) == "table" then
                filetype = vim.tbl_extend("force", filetype, vim.g.formatter_filetype_overrides)
            end

            return {
                logging = true,
                log_level = vim.log.levels.WARN,
                filetype = filetype,
            }
        end,
        keys = {
            {
                "<leader>fmt",
                function()
                    local ft = vim.bo.filetype
                    local fmt_config = require("formatter.config")
                    local has_ft_formatter = ft ~= "" and fmt_config.values.filetype[ft] ~= nil

                    if has_ft_formatter then
                        vim.cmd("Format")
                        return
                    end

                    local ok, lsp_kickstart = pcall(require, "lsp_kickstart")
                    if ok then
                        lsp_kickstart.kickstart_and_run({
                            method = "textDocument/formatting",
                            action = function()
                                vim.lsp.buf.format({ async = false, timeout_ms = 30000 })
                                vim.cmd("Format")
                            end,
                            fallback = function()
                                vim.cmd("Format")
                            end,
                            desc = "Format buffer",
                        })
                    else
                        vim.cmd("Format")
                    end
                end,
                mode = "n",
                desc = "Format buffer (formatter.nvim or LSP)",
            },
        },
        extra_contexts = {"firenvim", "vscode"},
    },
}
