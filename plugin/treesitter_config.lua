if vim.fn.match(vim.opt.runtimepath:get(), "nvim-treesitter") == -1 then
   return
end

local langs = {"lua", "vim", "python", "ruby"}

require'nvim-treesitter.configs'.setup {
   ensure_installed = langs,


   highlight = {
      enable = false,
      additional_vim_regex_highlighting = false,
   },

   incremental_selection = {
      enable = true,
      keymaps = {
         init_selection = "ghh", -- set to `false` to disable one of the mappings
         node_incremental = "gh]",
         scope_incremental = "gh}",
         node_decremental = "gh[",
      },
   },

   indent = {
      enable = true
   },
}

local group = vim.api.nvim_create_augroup("TreesitterAutogroup", {
  clear = true
})

for _, lang in ipairs(langs) do
   vim.api.nvim_create_autocmd({ 'FileType' }, {
     group = group,
     pattern = lang,
     callback = function()
       vim.opt_local.foldmethod = "expr"
       vim.opt_local.foldexpr = "nvim_treesitter#foldexpr()"
     end,
   })
end


