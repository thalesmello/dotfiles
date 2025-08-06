return {
   {
        'mhartington/formatter.nvim',
        opts = function ()
            return {
                logging = true,
                log_level = vim.log.levels.WARN,

                filetype = {
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
            }
        end,
        keys = {
            {"<leader>fmt", "<cmd>Format<cr>", mode = "n"},
        },
        extra_contexts = {"firenvim"},
    },
}
