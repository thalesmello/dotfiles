return {
   {
      "andymass/vim-matchup",
      -- Defer matchparen so it highlights after the cursor settles instead of
      -- searching for the matching keyword on every CursorMoved. Keeps scrolling
      -- smooth in large, keyword-heavy files (e.g. fish's if/switch/for … end).
      -- Must be set before the plugin loads, hence `init` not `config`.
      init = function()
         vim.g.matchup_matchparen_deferred = 1
         vim.g.matchup_matchparen_deferred_show_delay = 150
         vim.g.matchup_matchparen_deferred_hide_delay = 300
         vim.g.matchup_matchparen_timeout = 100
      end,
      extra_contexts = {"firenvim", "lite_mode", "ssh"},
   },
}
