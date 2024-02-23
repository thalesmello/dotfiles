if vim.fn.match(vim.opt.runtimepath:get(), "vim-projectionist") == -1 then
   return
end

local config = vim.fn.stdpath("config")

vim.g.projectionist_heuristics = {
   [config .. "/init.lua"] = {
      [config .. "/lua/config/*.lua"] = {
         type = "config",
      },
      [config .. "/lua/*.lua"] = {
         type = "lua",
      },
   },
   ["dags/*"] = {
      ["dags/replication/*.py"] = { type = "replication" },
      ["dags/*.py"] = { type = "dag" },
   },
}

local function make_dbt_projection(module)
   local compiled_folder = "target/run/" .. module .. "/models"

   return {
      ["*.sql"] = {
         make = "dbt --no-use-colors run",
         prepend = {
            suffixesadd = { ".sql", ".csv" },
            path = { "models/**", "macros/**", "seeds/**" },
         }
      },
      ["models/*.sql"] = {
         alternate = {"models/{}.yml", compiled_folder .. "/{}.sql"},
         setlocal = {
            commentstring = "{open}# %s #{close}",
         },
         type = "model",

         dispatch = "dbt --no-use-colors run -m {basename}",
      },
      ["models/*.yml"] = {
         alternate = {compiled_folder .. "/{}.sql", "models/{}.sql"},
         type = "properties",
         template = {
            "version: 2",
            "",
            "models:",
            "  - name: {basename}",
            "    columns:",
            "      - name: id",
            "        tests:",
            "          - unique",
            "          - not_null",
         }
      },
      ["tests/*.sql"] = {
         dispatch = "dbt --no-use-colors test -m {basename}",
         type = "test"
      },
      [compiled_folder .. "/*.sql"] = {
         setlocal = { readonly = true, modifiable = false },
         type = "compiled",
         alternate = { "models/{}.sql" },
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

local function iter_projection(property, iterate)
   for _, result in ipairs(vim.fn["projectionist#query"](property)) do
      local _, projection = unpack(result)
      for prop, value in pairs(projection) do
         iterate(prop, value)
      end

      break
   end
end

vim.api.nvim_create_autocmd("User", {
   pattern = "ProjectionistActivate",
   group = au_group,
   callback = function()
      iter_projection('setlocal', function (prop, value)
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
      end)

      iter_projection('prepend', function (prop, value)
         vim.opt_local[prop]:prepend(value)
      end)

      iter_projection('append', function (prop, value)
         vim.opt_local[prop]:append(value)
      end)
   end
})

