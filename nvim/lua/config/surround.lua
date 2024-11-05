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

local group = vim.api.nvim_create_augroup("NvimSurroungAutogroup", { clear = true })

vim.api.nvim_create_autocmd({ 'FileType' }, {
  group = group,
  pattern = {"sql", "jinja"},
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
        },

        ["#"] = {
          add = {"{# ", " #}"},
          find = "{#.-#}",
          delete = "^({#%s*)().-(%s*#})()"
        }
      }
    })
  end,
})

vim.api.nvim_create_autocmd({ 'FileType' }, {
  group = group,
  pattern = {"sql", "python"},
  callback = function()
    require("nvim-surround").buffer_setup({
      surrounds = {
        ["c"] = {
          add = function()
            local config = require("nvim-surround.config")
            local type = config.get_input("Enter the type to cast to: ")
            if type then
              return { { "CAST(" }, { " AS " .. type .. ")" } }
            end
          end,
          find = "CAST%(.-%s+AS%s+%w-%)",
          delete = "^([Cc][Aa][Ss][Tt]%(%s*)().-(%s+[Aa][Ss]%s+%w-%))()$",
        },

      }
    })
  end,
})


vim.api.nvim_create_autocmd({ 'filetype' }, {
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
            return require("nvim-surround.config").get_selection({ query = { capture = "@multiline_string.outer", type = "textobjects" } })
          end,
          delete = [=[^(f?['"]['"]['"])().-(['"]['"]['"])()$]=],
        },
        ["Q"] = {
          add = {"'''", "'''"},
          find = function ()
            return require("nvim-surround.config").get_selection({ query = { capture = "@multiline_string.outer", type = "textobjects" } })
          end,
          delete = [=[^(f?['"]['"]['"])().-(['"]['"]['"])()$]=],
        },
        ["="] = {
          add = {"", "="},
          find = [[[%w_]+%s-=%s*]],
          delete = [=[^()()[%w_]+(%s*=)()$]=],
        },
        ["+"] = {
          add = {"", " = "},
          find = [[[%w_]+%s-=%s*]],
          delete = [=[^()()[%w_]+(%s-=%s-)()$]=],
        },
        [":"] = {
          add = {'"', '": '},
          find = [=[['"][%w_]+['"]%s-:%s+]=],
          delete = [=[^(['"])()[%w_]+(['"]%s-:%s-)()$]=],
        },
      }
    })
  end,
})
