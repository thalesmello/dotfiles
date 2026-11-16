-- Shared org.nvim configuration loaded by both Neovim (lua/plugins/org.lua)
-- and the standalone `org` CLI (nvim --headless -l).
return {
  org_directory = "~/org",
  agenda_files = { "~/org/**/*.org" },
  default_notes_file = "~/org/refile.org",
  extensions = {
    cli = {
      install_dir = "~/src/dotfiles/bin",
    },
  },
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
}
