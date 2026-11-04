# frozen_string_literal: true

cask "alfred-1password" do
  version "26.1"
  sha256 "1c5c96fb6e1ff4659bbb3ff33650dad852aa3f39d0125ffa15036359a6088c0c"

  url "https://raw.githubusercontent.com/alfredapp/gallery-workflows/e6f13c388c6c2ddc802d4540e96b1cbeaf91f3f5/workflows/alfredapp/1password.alfredworkflow"
  name "1Password"
  desc "Search and open 1Password items"
  homepage "https://alfred.app/workflows/alfredapp/1password/"

  depends_on cask: "alfred"
  depends_on cask: "1password-cli"

  require_relative "../lib/alfred"
  AlfredWorkflows.install(self, bundle_id: "com.alfredapp.vitor.1password")
end
