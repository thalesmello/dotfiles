# frozen_string_literal: true

cask "alfred-word-complete" do
  require_relative "../lib/alfred"
  source = Pathname.new(__dir__)/"alfred-word-complete"

  version "0.3"
  sha256 Digest::SHA256.file(source/"info.plist").hexdigest
  url AlfredWorkflows.file_url(source/"info.plist")
  container type: :naked

  name "Word Complete for Alfred"
  desc "Save words and complete them from Alfred"
  homepage "https://github.com/thalesmello/dotfiles"

  depends_on cask: "alfred"
  depends_on formula: "fzf"
  depends_on formula: "jq"

  AlfredWorkflows.install(self, bundle_id: "me.thalesmello.alfred.wordcomplete", source: source)
end
