if vim.fn.match(vim.opt.runtimepath:get(), "vim-projectionist") == -1 then
   return
end

vim.g.projectionist_heuristics = {
   ["autoload/&plugin/"] = {

      ["autoload/*.vim"] = {
         alternate = "plugin/{}.vim",
         type = "autoload",
      },

      ["plugin/*.vim"] = {
         alternate = "autoload/{}.vim",
         type = "config",
      },


      ["plugin/*.lua"] = {
         type = "config",
      }
   },
   ["dags/*"] = {
      ["dags/replication/*.py"] = { type = "replication" },
      ["dags/*.py"] = { type = "dag" },
   },
}

local function make_dbt_projection(module)
   local compiled_folder = "target/run/" .. module .. "/models"

   return {
         ["models/*.sql"] = {
            alternate = {"models/{}.yml", compiled_folder .. "/{}.sql"},
            type = "model",
         },
         ["models/*.yml"] = {
            alternate = {compiled_folder .. "/{}.sql", "models/{}.sql"},
            type = "properties",
         },
         ["target/run/" .. module .. "/models/*.sql"] = {
            setlocal = { readonly = true, modifiable=false },
            type = "compiled",
            alternate = { "models/{}.sql" },
         },
         ["*.sql"] = {
            make = "dbt --no-use-colors run",
            dispatch = "dbt --no-use-colors compile",
         }
      }
end

local au_group = vim.api.nvim_create_augroup("ProjectionistConfig", { clear = true })

vim.api.nvim_create_autocmd("User", {
   pattern = "ProjectionistDetect",
   group = au_group,
   callback = function ()
      local root = vim.fn.getcwd()
      if vim.fn.filereadable(root .. "/dbt_project.yml") ~= 0 then
         local basename = vim.fs.basename(root)
         local module = vim.fn.substitute(basename, "-", "_", "g")

         local projection = make_dbt_projection(module)
         vim.pretty_print(projection)
         vim.fn["projectionist#append"](root .. "/", projection)
      end
   end
})

vim.api.nvim_create_autocmd("User", {
   pattern = "ProjectionistActivate",
   group = au_group,
   callback = function()
      for _, result in ipairs(vim.fn["projectionist#query"]('setlocal')) do
         local _, projection = unpack(result)
         for prop, value in pairs(projection) do

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

         break
      end
   end
})

