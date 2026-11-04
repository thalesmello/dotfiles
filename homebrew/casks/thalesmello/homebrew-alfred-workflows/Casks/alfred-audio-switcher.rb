# frozen_string_literal: true

cask "alfred-audio-switcher" do
  version "1.6.0"
  sha256 "c912a91f2486cc55b01f5372f2a8159ed1994af99e82735c2bd9385079536bdd"

  url "https://raw.githubusercontent.com/alfredapp/gallery-workflows/8ed72483d95ffda40d9f1bd2e30f4ee21ce3f8d6/workflows/tobiasmende/audio-switcher.alfredworkflow"
  name "Audio Switcher"
  desc "Swiftly switch audio output and input devices"
  homepage "https://alfred.app/workflows/tobiasmende/audio-switcher/"

  depends_on cask: "alfred"

  require_relative "../lib/alfred"
  AlfredWorkflows.install(self, bundle_id: "io.mende.alfredapp-audioswitcher")
end
