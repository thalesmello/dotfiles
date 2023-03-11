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
   ["models/*&dbt_project.yml"] = {
      ["models/*.sql"] = { alternate = "models/{}.yml", type = "model" },
      ["models/*.yml"] = { alternate = "models/{}.sql", type = "properties" },
      ["target/run/**/models/*.sql"] = {
         setlocal = { readonly = true },
         type = "compiled",
         alternate = { "models/{}.sql" },
      },
      ["*"] = { make = "dbt run" }
   },
   ["dags/*"] = {
      ["dags/replication/*.py"] = { type = "replication" },
      ["dags/*.py"] = { type = "dag" },
   },
}


local au_group = vim.api.nvim_create_augroup("ProjectionistConfig", { clear = true })
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
