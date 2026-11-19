# frozen_string_literal: true

require "digest"
require "uri"

class HammerspoonHidtap < Formula
  env :std
  desc "HID-level event tap for Hammerspoon Mission Control mouse actions"
  homepage "https://github.com/thalesmello/dotfiles"
  source = Pathname.new(__dir__).parent/"hs_hidtap.c"
  url "file://#{URI::DEFAULT_PARSER.escape(source.to_s)}"
  version "1.0.0"
  sha256 Digest::SHA256.file(source).hexdigest

  depends_on :macos

  def install
    app = Pathname.new("/Applications/Hammerspoon.app")
    headers = app/"Contents/Frameworks/LuaSkin.framework/Versions/A/Headers"
    odie "Install Hammerspoon.app in /Applications before building this helper" unless (headers/"lua.h").exist?
    system ENV.cc, "-O2", "-bundle", "-undefined", "dynamic_lookup",
           "-I#{headers}", "-framework", "ApplicationServices",
           "-framework", "CoreFoundation", "hs_hidtap.c", "-o", "hs_hidtap.so"
    system "/usr/bin/codesign", "--force", "--sign", "-", "hs_hidtap.so"
    lib.install "hs_hidtap.so"
    # Homebrew install moves its input: copy out of the app bundle first.
    system "/bin/cp", app/"Contents/Info.plist", "Hammerspoon-Info.plist"
    (share/"hammerspoon-hidtap").install "Hammerspoon-Info.plist"
  end

  def caveats
    <<~EOS
      This helper uses Hammerspoon's private eventtap ABI. After upgrading
      Hammerspoon, run:
        brew reinstall thalesmello/hammerspoon/hammerspoon-hidtap
      Then reload Hammerspoon. The runtime checks the recorded app version.
    EOS
  end

  test do
    assert_path_exists lib/"hs_hidtap.so"
    assert_match "_luaopen_hs_hidtap", shell_output("/usr/bin/nm -g #{lib}/hs_hidtap.so")
  end
end
