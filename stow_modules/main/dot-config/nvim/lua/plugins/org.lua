-- ~/.config/nvim/lua/plugins/org.lua
return {
  "xheisenbugx/org.nvim",
  main = "org",
  lazy = false, -- startup cost is small: heavy modules load on first use
  opts = {
    org_directory = "~/org",
    agenda_files = { "~/org/**/*.org" },
    default_notes_file = "~/org/refile.org",
    mappings = {
      global = {
        clock_goto = "<prefix>Xj",
        clock_out = "<prefix>Xo",
        clock_cancel = "<prefix>Xq",
      },
      org = {
        toggle_checkbox = { "<C-Space>", "<prefix>x" },
        clock_in = "<prefix>Xi",
        clock_out = "<prefix>Xo",
        clock_cancel = "<prefix>Xq",
        clock_goto = "<prefix>Xj",
        set_effort = "<prefix>Xe",
        inc_effort = "<prefix>XE",
        clock_modify_effort = "<prefix>Xm",
        clock_resolve = "<prefix>Xz",
        clock_report = "<prefix>Xr",
        clock_display = "<prefix>Xd",
        link_preview = "<prefix>Xv",
        link_preview_refresh = "<prefix>XV",
        latex_preview = "<prefix>Xl",
        dblock_update = "<prefix>Xu",
        dblock_update_all = "<prefix>XU",
      },
    },
  },
}
