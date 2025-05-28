return {
   {
      "David-Kunz/gen.nvim",
      opts = {
         model = "deepseek-r1:1.5b", -- The default model to use.
         ---@param opts { result_string: string,  }
         extract = function (opts)
            local result = opts.result_string:match("^<think>.-</think>(.*)$")
            vim.print('hello')

            if result then
               return result
            else
               return opts.result_string
            end
         end,
         quit_map = "q", -- set keymap to close the response window
         retry_map = "<c-r>", -- set keymap to re-send the current prompt
         accept_map = "<leader><M-cr>", -- set keymap to replace the previous selection with the last result
         host = "localhost", -- The host running the Ollama service.
         port = "11434", -- The port on which the Ollama service is listening.
         display_mode = "float", -- The display mode. Can be "float" or "split" or "horizontal-split".
         show_prompt = false, -- Shows the prompt submitted to Ollama. Can be true (3 lines) or "full".
         show_model = false, -- Displays which model you are using at the beginning of your chat session.
         no_auto_close = false, -- Never closes the window automatically.
         file = false, -- Write the payload to a temporary file to keep the command short.
         hidden = false, -- Hide the generation window (if true, will implicitly set `prompt.replace = true`), requires Neovim >= 0.10
         -- The command for the Ollama service. You can use placeholders $prompt, $model and $body (shellescaped).
         -- This can also be a command string.
         -- The executed command must return a JSON object with { response, context }
         -- (context property is optional).
         -- list_models = '<omitted lua function>', -- Retrieves a list of model names
         result_filetype = "markdown", -- Configure filetype of the result buffer
         debug = false -- Prints errors and the command which is run.
      },
      config = function (_, opts)
         require("gen").setup(opts)

         require('gen').prompts['Elaborate_Text'] = {
            prompt = "Elaborate the following text:\n$text",
            replace = true
         }
      end,
      keys = {
         {"<leader>\\", ':Gen<CR>', mode = {"n", "v"}}
      },
      extra_contexts = {"firenvim"},
   }
}
