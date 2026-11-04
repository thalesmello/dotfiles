# frozen_string_literal: true

cask "alfred-calm-notifications" do
  version "2025.1"
  sha256 "421bfa7d7c86ce58bd27b58d099176dcd99fba8301bc1687c990e72612ff1624"

  url "https://github.com/vitorgalvao/calm-notifications-workflow/releases/download/2025.1/Calm.Notifications.alfredworkflow"
  name "Calm Notifications"
  desc "Toggle Do Not Disturb Focus Mode"
  homepage "https://alfred.app/workflows/vitor/calm-notifications/"

  depends_on cask: "alfred"

  require_relative "../lib/alfred"
  AlfredWorkflows.install(self, bundle_id: "com.vitorgalvao.alfred.calmnotifications")
end
