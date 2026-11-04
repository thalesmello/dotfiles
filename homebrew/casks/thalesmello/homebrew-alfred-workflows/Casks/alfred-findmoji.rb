# frozen_string_literal: true

cask "alfred-findmoji" do
  version "1.0.2"
  sha256 "7bbc627e81b9feecf06e3f3b45ea8841fabd70ed8a1650bdde73d20d18544cc0"

  url "https://raw.githubusercontent.com/alfredapp/gallery-workflows/52b4584eeaa69317f9e57cc145c3e6b060164c95/workflows/rknightuk/findmoji.alfredworkflow"
  name "Findmoji"
  desc "Find and paste emoji"
  homepage "https://rknight.me"

  depends_on cask: "alfred"

  require_relative "../lib/alfred"
  AlfredWorkflows.install(self, bundle_id: "com.rknightuk.findmoji")
end
