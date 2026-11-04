# frozen_string_literal: true

cask "alfred-default-folder-x" do
  version "0.4.0"
  sha256 "f7f5bbc2f2ca55b5691758d9b7bc4d7f31642b70dfca39679b62f64e09eef0d4"

  url "https://raw.githubusercontent.com/thalesmello/alfred-default-folder-x/89a7eb69f59a48d8094bb06ce4cb52664ac2a8c4/Default-Folder-X-0.4.0.alfredworkflow"
  name "Default Folder X"
  desc "Show and search Default Folder X favourites and recent items."
  homepage "https://github.com/deanishe/alfred-default-folder-x"

  depends_on cask: "alfred"
  depends_on cask: "default-folder-x"

  require_relative "../lib/alfred"
  AlfredWorkflows.install(self, bundle_id: "net.deanishe.alfred-dfx")
end
