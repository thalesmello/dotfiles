-- local config = vim.fn.stdpath("config")
local data = vim.fn.stdpath("data")

local function template(str)
   return vim.split(str, "\n")
end

vim.g.projectionist_heuristics = {
   ["init.lua"] = {
      ["lua/config/*.lua"] = {
         type = "config",
      },
      ["lua/plugins/*.lua"] = {
         type = "plugin",
         template = template([=[
return {
   {
      "plugin",
      -- opts = {}
      -- config = function () end
   }
}
]=])
      },
      ["lua/*.lua"] = {
         type = "lua",
      },
      ["local_plugins/**/lua/*.lua"] = {
         type = "localplugins",
      },
      ["after/queries/*/textobjects.scm"] = {
         type = "textobjects",
      },
      ["lua/ftmini/*.lua"] = {
         type = "ftmini",
      },
   },
   [data .. '/lazy/'] = {
      [data .. '/lazy/**/README*'] = {
         type = "lazyplugin",
         onload = {'plcd'},
      },
   },
   ["dags/*"] = {
      ["dags/replication/*.py"] = { type = "replication" },
      ["dags/*.py"] = { type = "dag" },
   },
   [".git/"] = {
      ["README.md"] = { type = "readme" },
   },
}

local function make_dbt_projection(module)
   local compiled_folder = "target/run/" .. module

   return {
      ["*.sql"] = {
         make = "dbt --no-use-colors run",
         prepend = {
            suffixesadd = { ".sql", ".csv" },
            path = { "models/**", "macros/**", "seeds/**" },
         }
      },
      ["models/*.sql"] = {
         alternate = {"models/{}.yml", compiled_folder .. "/models/{}.sql"},
         setlocal = {
            commentstring = "{open}# %s #{close}",
         },
         type = "model",
         dispatch = "dbt --no-use-colors run -m {basename}",
      },
      ["models/*.yml"] = {
         alternate = {compiled_folder .. "/models/{}.sql", "models/{}.sql"},
         type = "properties",
         template = template([=[
version: 2

models:
  - name: {basename}
    columns:
      - name: id
        tests:
          - unique
          - not_null
]=])
      },
      ["tests/*.sql"] = {
         dispatch = "dbt --no-use-colors test -m {basename}",
         type = "test",
         alternate = { compiled_folder .. "/tests/{}.sql" },
      },
      [compiled_folder .. "/models/*.sql"] = {
         setlocal = { readonly = true, modifiable = false },
         type = "compiled",
         alternate = { "models/{}.sql" },
      },
      [compiled_folder .. "/tests/*.sql"] = {
         setlocal = { readonly = true, modifiable = false },
         type = "compiledtests",
         alternate = { "tests/{}.sql" },
      },
   }
end

local au_group = vim.api.nvim_create_augroup("ProjectionistConfig", { clear = true })

vim.api.nvim_create_autocmd("User", {
   pattern = "ProjectionistDetect",
   group = au_group,
   callback = function ()
      local root = vim.fn.getcwd()
      if root == nil then
         return
      end
      if vim.fn.filereadable(root .. "/dbt_project.yml") ~= 0 then
         local basename = vim.fs.basename(root)
         if basename == nil then
            return ""
         end
         local module = vim.fn.substitute(basename, "-", "_", "g")

         local projection = make_dbt_projection(module)
         vim.fn["projectionist#append"](root .. "/", projection)
      end
   end
})

local function iter_projection(property)
   local result = unpack(vim.iter(vim.fn["projectionist#query"](property)):take(1):totable())
   local _, projection = unpack(result or {})
   return vim.iter(projection or {})
end

local onload_fns = {
   plcd = function()
      vim.cmd.Plcd()
   end
}

vim.api.nvim_create_autocmd("User", {
   pattern = "ProjectionistActivate",
   group = au_group,
   callback = function()
      for prop, value in iter_projection('setlocal') do
         if value == "v:true" then
            value = true
         elseif value == "v:false" then
            value = false
         else
            local aux = tonumber(value)

            if aux ~= nil then
               value = aux
            end
         end

         vim.opt_local[prop] = value
      end

      for prop, value in iter_projection('prepend') do
         vim.opt_local[prop]:prepend(value)
      end

      for prop, value in iter_projection('append') do
         vim.opt_local[prop]:append(value)
      end


      for value in iter_projection('onload') do
         local onload_func = onload_fns[value]
         if onload_func then
            onload_func()
         end
      end
   end
})

vim.keymap.set("n", "<leader>cd", "<cmd>Plcd<cr>", { noremap = true, silent = true })
