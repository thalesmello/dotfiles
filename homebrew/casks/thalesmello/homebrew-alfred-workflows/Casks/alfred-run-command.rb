# frozen_string_literal: true

cask "alfred-run-command" do
  version "2024.2"
  sha256 "aa4d90283fc788b3155df8e126b07c714be61fef97783373f514b273c0f9552d"

  url "https://github.com/vitorgalvao/run-command-workflow/releases/download/2024.2/Run.Command.alfredworkflow"
  name "Run Command"
  desc "Run commands using your shell configuration"
  homepage "https://github.com/vitorgalvao/run-command-workflow/"

  depends_on cask: "alfred"

  require_relative "../lib/alfred"
  AlfredWorkflows.install(self, bundle_id: "com.vitorgalvao.alfred.runcommand")
end
