# frozen_string_literal: true

cask "alfred-new-folder" do
  version "1.31"
  sha256 "1197f3afe6c627df9e94270354dc6e4c1442605a5800c9f5dfef3f2cbe671fea"

  url "https://raw.githubusercontent.com/alfredapp/gallery-workflows/8332b4ff7e5e7f8defaf2d08f7365939a386c9f7/workflows/stephenc/new-folder.alfredworkflow"
  name "New folder"
  desc "Make a new folder in this folder"
  homepage "https://alfred.app/workflows/stephenc/new-folder/"

  depends_on cask: "alfred"

  require_relative "../lib/alfred"
  AlfredWorkflows.install(self, bundle_id: "app.alfred.stephenc.newfolder")
end
