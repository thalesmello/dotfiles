# frozen_string_literal: true

cask "alfred-system-settings" do
  version "2025.1"
  sha256 "5584f0c5648b18ea4c55a37d72ba0de7e657cd5c0695953124bfd53993ab0ea9"

  url "https://github.com/alfredapp/system-settings-workflow/releases/download/2025.1/System.Settings.alfredworkflow"
  name "System Settings"
  desc "Open macOS System Settings Panes"
  homepage "https://alfred.app/workflows/alfredapp/system-settings/"

  depends_on cask: "alfred"

  require_relative "../lib/alfred"
  AlfredWorkflows.install(self, bundle_id: "com.alfredapp.vitor.systemsettings")
end
