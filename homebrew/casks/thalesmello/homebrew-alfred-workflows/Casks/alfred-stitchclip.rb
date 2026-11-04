# frozen_string_literal: true

cask "alfred-stitchclip" do
  version "1.1.0"
  sha256 "f21c684a98d0633ba7f139b3c7dfb1a113fb8b7bd450575c0ca76dd48b80929b"

  url "https://raw.githubusercontent.com/alfredapp/gallery-workflows/5bee21d30699f7f9651badcceec9692c5d7aed64/workflows/outlawandy/stitchclip.alfredworkflow"
  name "StitchClip"
  desc "Paste 2 (or more) clipboard entries at once, separated by a new line, space (\u21e7), or comma (\u2325)"
  homepage "https://alfred.app/workflows/outlawandy/stitchclip/"

  depends_on cask: "alfred"

  require_relative "../lib/alfred"
  AlfredWorkflows.install(self, bundle_id: "com.outlawandy.stitchclip")
end
