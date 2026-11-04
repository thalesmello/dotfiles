# frozen_string_literal: true

cask "alfred-sequential-paste" do
  version "2024.2"
  sha256 "163227287f244e0507b0a7964d6d6fc5aed87215aa123f1fb1bcd930feb61cd4"

  url "https://raw.githubusercontent.com/alfredapp/gallery-workflows/484b0700440a8b8ed3e05c3068267b7fadf50bc9/workflows/vitor/sequential-paste.alfredworkflow"
  name "Sequential Paste"
  desc "Paste previous clipboard entries in order"
  homepage "https://alfred.app/workflows/vitor/sequential-paste/"

  depends_on cask: "alfred"

  require_relative "../lib/alfred"
  AlfredWorkflows.install(self, bundle_id: "com.vitorgalvao.alfred.sequentialpaste")
end
