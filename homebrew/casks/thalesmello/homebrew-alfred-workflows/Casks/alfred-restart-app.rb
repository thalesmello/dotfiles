# frozen_string_literal: true

cask "alfred-restart-app" do
  version "1.0"
  sha256 "568153029694d5e00599674f29b72d74cc3d1ce50ba84e398f1bc5d583e1110e"

  url "https://raw.githubusercontent.com/packal/repository/1eb1d58b41855a5299c0421c6cdbe14b6e87cc20/com.sulaiman.restartapp/restart_app.alfredworkflow"
  name "Restart App"
  desc "Restart or Quit an App without using Dock or Activity Monitor. Inspired by Bedartha's Relaunch App Workflow"
  homepage "https://www.packal.org/workflow/restart-app"

  depends_on cask: "alfred"

  require_relative "../lib/alfred"
  AlfredWorkflows.install(self, bundle_id: "com.sulaiman.restartapp")
end
