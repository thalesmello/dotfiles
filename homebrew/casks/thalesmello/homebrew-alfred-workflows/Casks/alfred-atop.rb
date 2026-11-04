# frozen_string_literal: true

cask "alfred-atop" do
  version "1.9.3"
  sha256 "4fefd6e97ed5c5c00c2b2cc2ed5220ca9574de5d181f3ccc97c6252d7b19f277"

  url "https://github.com/chrisgrieser/alfred-atop/releases/download/1.9.3/alfred-atop.alfredworkflow"
  name "atop"
  desc "System Monitoring and Process Management"
  homepage "https://chris-grieser.de/"

  depends_on cask: "alfred"

  require_relative "../lib/alfred"
  AlfredWorkflows.install(self, bundle_id: "de.chris-grieser.atop")
end
