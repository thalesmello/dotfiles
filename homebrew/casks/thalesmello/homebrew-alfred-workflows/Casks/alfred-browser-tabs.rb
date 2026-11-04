# frozen_string_literal: true

cask "alfred-browser-tabs" do
  version "1.0.7"
  sha256 "edd9c680c4275ddd90bf0248fc502ab7a93c0c80087795a8f98136ac78a5c1e5"

  url "https://github.com/epilande/alfred-browser-tabs/releases/download/v1.0.7/Browser-Tabs.alfredworkflow"
  name "Browser Tabs"
  desc "Search browser tabs from Chrome, Arc, Brave, Safari, etc.."
  homepage "https://github.com/epilande/alfred-browser-tabs"

  depends_on cask: "alfred"

  require_relative "../lib/alfred"
  AlfredWorkflows.install(self, bundle_id: "com.epilande.browser-tabs")
end
