# frozen_string_literal: true

cask "alfred-markdown-transform" do
  version "26.1"
  sha256 "d7381b9520133deb02124409947b0d2d6e50c5846ba792241800ce0465e07df1"

  url "https://raw.githubusercontent.com/alfredapp/gallery-workflows/b45367add708ffa3069f047271e0e5fb683e7cfb/workflows/vitor/markdown-transform.alfredworkflow"
  name "Markdown Transform"
  desc "Convert Markdown to BBCode, HTML, and RTF"
  homepage "https://alfred.app/workflows/vitor/markdown-transform/"

  depends_on cask: "alfred"

  require_relative "../lib/alfred"
  AlfredWorkflows.install(self, bundle_id: "com.vitorgalvao.alfred.markdowntransform")
end
