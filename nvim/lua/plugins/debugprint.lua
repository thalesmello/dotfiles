return {
   "thalesmello/debugprint.nvim",
   opts = {
      keymaps = {
         normal = {
            plain_below = "g.",
            plain_above = '',
            variable_below = 'g?',
            variable_above = '',
            variable_below_alwaysprompt = '',
            variable_above_alwaysprompt = '',
            textobj_below = "g/",
            textobj_above = '',
            toggle_comment_debug_prints = '',
            delete_debug_prints = '',
         },

         insert = {
            plain = "<C-G>p",
            variable = "<C-G>v",
         },

         visual = {
            variable_below = "g?",
            variable_above = '',
         },
      },

      commands = {
         toggle_comment_debug_prints = "ToggleCommentDebugPrints",
         delete_debug_prints = "DeleteDebugPrints",
      },
   },
}
