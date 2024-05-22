require("nvim-surround").setup({
  keymaps = {
    insert = "<c-s>",
    insert_line = "<C-s><c-s>",
  },
  -- surrounds =     -- Defines surround keys and behavior
  aliases = {
    ["a"] = false,
    ["b"] = false,
    ["B"] = false,
    ["r"] = false,
    ["q"] = false,
    ["s"] = false,
  },
  -- highlight =     -- Defines highlight behavior
  move_cursor = true,
  -- indent_lines =  -- Defines line indentation behavior,
})

local group = vim.api.nvim_create_augroup("NvimSurroungAutogroup", {
  clear = true
})

vim.api.nvim_create_autocmd({ 'FileType' }, {
  group = group,
  pattern = "sql",
  callback = function()
    require("nvim-surround").buffer_setup({
      surrounds = {
        ["<c-]>"] = {
          add = {"{{ ", " }}"},
          find = "{{.-}}",
          delete = "^({{%s*)().-(%s*}})()$",
        },

        ["%"] = {
          add = {"{% ", " %}"},
          find = "{%%%-?.-%-?%%}",
          delete = "^({%%%-?%s*)().-(%s*%-?%%})()"
        },

        ["-"] = {
          add = {"{%- ", " -%}"},
          find = "{%%%-?.-%-?%%}",
          delete = "^({%%%-?%s*)().-(%s*%-?%%})()"
        }
      }
    })
  end,
})


vim.api.nvim_create_autocmd({ 'FileType' }, {
  group = group,
  pattern = "lua",
  callback = function()
    require("nvim-surround").buffer_setup({
      surrounds = {
        ["<c-f>"] = {
          add = {"function () ", " end"},
          find = function ()
            return require("nvim-surround.config").get_selection({node = "function_definition"})
          end,
          delete = "^(function%s*%(%)%s*)().-(%s*end)()$",
        },
        ["q"] = {
          add = {"[[", "]]"},
          find = function ()
            return require("nvim-surround.config").get_selection({node = "string"})
          end,
          delete = "^(%[=*%[)().-(%]=*%])()$",
        },
        ["Q"] = {
          add = {"[=[", "]=]"},
          find = function ()
            return require("nvim-surround.config").get_selection({node = "string"})
          end,
          delete = "^(%[=*%[)().-(%]=*%])()$",
        },
      }
    })
  end,
})


vim.api.nvim_create_autocmd({ 'FileType' }, {
  group = group,
  pattern = "python",
  callback = function()
    require("nvim-surround").buffer_setup({
      surrounds = {
        ["q"] = {
          add = {'"""', '"""'},
          find = function ()
            return require("nvim-surround.config").get_selection({ motion = "aq" })
          end,
          delete = [=[^(f?""")().-(""")()$]=],
        },
        ["Q"] = {
          add = {"'''", "'''"},
          find = function ()
            return require("nvim-surround.config").get_selection({ motion = "aq" })
          end,
          delete = [=[^(f?''')().-(''')()$]=],
        },
      }
    })
  end,
})
