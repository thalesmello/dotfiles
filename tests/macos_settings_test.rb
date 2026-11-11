# frozen_string_literal: true

require "minitest/autorun"
require "open3"
require "pathname"
require "tmpdir"

class MacosSettingsTest < Minitest::Test
  ROOT = Pathname.new(__dir__).parent
  MACOS_SCRIPT = ROOT/"scripts/macos_settings.sh"
  EXCLUSIONS_FILE = ROOT/"scripts/spotlight-exclusions.txt"
  DEFAULTS_DIFF = ROOT/"bin/defaults-diff"

  EXPECTED_DEFAULTS = [
    ["-g", "InitialKeyRepeat", "20"],
    ["-g", "KeyRepeat", "2"],
    ["-g", "ApplePressAndHoldEnabled", "0"],
    ["com.apple.AppleMultitouchTrackpad", "TrackpadThreeFingerDrag", "1"],
    ["com.apple.AppleMultitouchTrackpad", "TrackpadFiveFingerPinchGesture", "2"],
    ["com.apple.AppleMultitouchTrackpad", "TrackpadFourFingerHorizSwipeGesture", "2"],
    ["com.apple.AppleMultitouchTrackpad", "TrackpadFourFingerPinchGesture", "2"],
    ["com.apple.AppleMultitouchTrackpad", "TrackpadThreeFingerHorizSwipeGesture", "0"],
    ["com.apple.AppleMultitouchTrackpad", "TrackpadThreeFingerVertSwipeGesture", "0"],
    ["com.apple.AppleMultitouchTrackpad", "TrackpadThreeFingerTapGesture", "0"],
    ["com.apple.AppleMultitouchTrackpad", "Clicking", "0"],
    ["/Library/Preferences/com.apple.airport.bt.plist", "bluetoothCoexMgmt", "Hybrid"],
    ["com.apple.dock", "mineffect", "scale"],
    ["com.apple.dock", "mru-spaces", "0"],
    ["com.apple.dock", "expose-group-apps", "1"],
    ["com.apple.spaces", "spans-displays", "0"],
    ["NSGlobalDomain", "_HIHideMenuBar", "0"],
    ["NSGlobalDomain", "AppleMenuBarVisibleInFullscreen", "0"],
    ["NSGlobalDomain", "AppleKeyboardUIMode", "2"]
  ].freeze

  def configured_spotlight_exclusions
    EXCLUSIONS_FILE.readlines.filter_map do |raw|
      line = raw.sub(/\s*#.*$/, "").strip
      next if line.empty?

      line.start_with?("~/") ? File.join(Dir.home, line.delete_prefix("~/")) : line
    end
  end

  def test_macos_settings_script_syntax
    assert MACOS_SCRIPT.file?, "scripts/macos_settings.sh must exist"
    _, err, status = Open3.capture3("sh", "-n", MACOS_SCRIPT.to_s)
    assert status.success?, "sh -n failed: #{err}"
  end

  def test_spotlight_exclusions_file_is_well_formed
    assert EXCLUSIONS_FILE.file?, "scripts/spotlight-exclusions.txt must exist"
    entries = configured_spotlight_exclusions
    refute_empty entries
    entries.each do |entry|
      assert entry.start_with?("/"), "Expanded exclusion must be an absolute path: #{entry}"
    end
    assert_equal entries.uniq, entries, "Duplicate entries in scripts/spotlight-exclusions.txt"
  end

  def test_defaults_diff_parses_and_diffs_snapshots
    assert DEFAULTS_DIFF.executable?, "bin/defaults-diff must be executable"
    Dir.mktmpdir("defaults-diff-test-") do |tmp|
      tmp_path = Pathname.new(tmp)
      before = tmp_path/"before/user"
      after = tmp_path/"after/user"
      before.mkpath
      after.mkpath
      (before/"com.apple.dock").write("mineffect = genie;\nmru-spaces = 1;\n")
      (after/"com.apple.dock").write("mineffect = scale;\nmru-spaces = 0;\n")

      out, err, status = Open3.capture3(
        DEFAULTS_DIFF.to_s, "--before", (tmp_path/"before").to_s, "--after", (tmp_path/"after").to_s
      )
      assert status.success?, "defaults-diff failed: #{err}"
      assert_includes out, "com.apple.dock"
      assert_includes out, "-mineffect = genie;"
      assert_includes out, "+mineffect = scale;"

      scoped_out, scoped_err, scoped_status = Open3.capture3(
        DEFAULTS_DIFF.to_s, "--before", (tmp_path/"before").to_s, "--after", (tmp_path/"after").to_s, "com.apple.dock"
      )
      assert scoped_status.success?, "scoped defaults-diff failed: #{scoped_err}"
      assert_includes scoped_out, "+mineffect = scale;"
    end
  end

  def test_live_macos_defaults_match_dotfiles
    skip "macOS only" unless RUBY_PLATFORM.include?("darwin")

    EXPECTED_DEFAULTS.each do |domain, key, expected|
      out, err, status = Open3.capture3("defaults", "read", domain, key)
      assert status.success?, "Failed reading #{domain} #{key}: #{err}"
      assert_equal expected, out.strip, "Drift detected for `defaults read #{domain} #{key}`"
    end

    hotkeys, err, status = Open3.capture3("defaults", "read", "com.apple.symbolichotkeys", "AppleSymbolicHotKeys")
    assert status.success?, "Failed reading AppleSymbolicHotKeys: #{err}"
    assert_match(/70\s*=\s*\{\s*enabled\s*=\s*0;/m, hotkeys, "Lookup word hotkey (70) should be disabled")
  end
end
