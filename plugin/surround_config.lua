if vim.fn.match(vim.opt.runtimepath:get(), "nvim-surround") == -1 then
   return
end

require("nvim-surround").setup({
  keymaps = {
    insert = "<c-s>",
    insert_line = "<C-s><c-s>",
  },
  -- surrounds =     -- Defines surround keys and behavior
  -- aliases =       -- Defines aliases
  -- highlight =     -- Defines highlight behavior
  move_cursor = false
  -- indent_lines =  -- Defines line indentation behavior
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
        ["i"] = {
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
        ["q"] = {
          add = {"[[", "]]"},
          find = "[[.-]]",
          delete = "^([[%s*)().-(%s*}})()$",
        },
      }
    })
  end,
})
