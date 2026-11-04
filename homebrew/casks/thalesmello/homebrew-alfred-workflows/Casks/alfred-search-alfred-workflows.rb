# frozen_string_literal: true

cask "alfred-search-alfred-workflows" do
  version "2.4.1"
  sha256 "cc3e97e759be0274679d16ea3ebe48d7bab0b7972858de419a25d495fd882f36"

  url "https://raw.githubusercontent.com/alfredapp/gallery-workflows/c7e1a0fc65d4d0767bee195594d2cc34b65ed65d/workflows/acidham/search-alfred-workflows.alfredworkflow"
  name "Search Alfred Workflows"
  desc "Browse Alfred Workflows"
  homepage "https://alfred.app/workflows/acidham/search-alfred-workflows/"

  depends_on cask: "alfred"
  depends_on formula: "python"

  require_relative "../lib/alfred"
  AlfredWorkflows.install(self, bundle_id: "com.apple.alfred.workflow.alfdir")
end
