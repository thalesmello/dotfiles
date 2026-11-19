# frozen_string_literal: true

# Thales's Neru fork (live overlay controls). HEAD-only: builds the fork branch
# from source, including the signed Neru.app bundle, until the changes land
# upstream and the y3owk1n/tap/neru cask can be used again.
class Neru < Formula
  desc "Keyboard-driven navigation for macOS (live overlay controls fork)"
  homepage "https://github.com/thalesmello/neru"
  head "https://github.com/thalesmello/neru.git", branch: "live-overlay-controls"
  license "MIT"

  depends_on "go" => :build
  depends_on :macos

  def install
    commit = Utils.git_short_head
    pkg = "github.com/y3owk1n/neru/internal/buildinfo"
    ldflags = %W[
      -s -w
      -X #{pkg}.Version=v1.63.0-fork-#{commit}
      -X #{pkg}.GitCommit=#{commit}
      -X #{pkg}.BuildDate=#{time.iso8601}
    ]
    ENV["CGO_ENABLED"] = "1"
    system "go", "build", *std_go_args(ldflags:), "./cmd/neru"
    system "go", "run", "./cmd/genman", man1

    # Same bundle layout and ad-hoc signature as scripts/dist.sh.
    contents = prefix/"Neru.app/Contents"
    (contents/"MacOS").mkpath
    (contents/"Resources").mkpath
    cp bin/"neru", contents/"MacOS/neru"
    cp "resources/icon.icns", contents/"Resources/icon.icns"
    cp "resources/Neru.entitlements", contents/"Resources/Neru.entitlements"
    plist = File.read("resources/Info.plist.template")
                .gsub("BUNDLE_VERSION", "1.63.0")
                .gsub("SHORT_VERSION", "1.63.0")
                .gsub("BUILD_ID", "fork-#{commit}")
    (contents/"Info.plist").write plist
    system "/usr/bin/codesign", "--force", "--deep", "--sign", "-",
           "--entitlements", "resources/Neru.entitlements", "--options", "runtime",
           prefix/"Neru.app"
  end

  def caveats
    <<~EOS
      The app bundle is built at:
        #{opt_prefix}/Neru.app
      To make it the active app (re-grant Accessibility afterwards):
        neru services stop
        ditto #{opt_prefix}/Neru.app ~/src/Applications/Neru.app
        neru services start
    EOS
  end

  test do
    assert_match "Neru version", shell_output("#{bin}/neru --version")
  end
end
