# frozen_string_literal: true

cask "alfred-calculate-anything" do
  version "4.0.7"
  sha256 "6e9aa532bd0322b4cea55d8afc2d9056b0b8a52aaea47e7da347166f80ddf615"

  url "https://github.com/biati-digital/alfred-calculate-anything/releases/download/4.0.7/Calculate.Anything.alfredworkflow"
  name "Calculate Anything"
  desc "Calculate Anything"
  homepage "https://github.com/biati-digital/alfred-calculate-anything"

  depends_on cask: "alfred"
  depends_on formula: "php"

  require_relative "../lib/alfred"
  AlfredWorkflows.install(self, bundle_id: "com.alfred.calculateanything")
end
