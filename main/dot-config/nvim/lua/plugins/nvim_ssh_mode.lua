if vim.env.NVIM_SSH_MODE == "1" then
  require("lazy.core.config").options.defaults.cond = require('conditional_load').should_load
end

return {
   {
      dir = vim.fn.stdpath("config") .. "/local_plugins/nvim_ssh_mode/",
      dev = true,
      config = function ()
      end
   }
}
