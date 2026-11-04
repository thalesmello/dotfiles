# frozen_string_literal: true

require "minitest/autorun"
require "tmpdir"
require_relative "../homebrew/casks/thalesmello/homebrew-alfred-workflows/lib/alfred"

class AlfredWorkflowsTest < Minitest::Test
  BUNDLE_ID = "org.example.workflow"
  TOKEN = "alfred-example"
  SOURCE = Pathname.new(__dir__).parent/"homebrew/casks/thalesmello/homebrew-alfred-workflows/Casks/alfred-word-complete"

  def setup
    @tmp = Pathname.new(Dir.mktmpdir("alfred-workflows-test-"))
    @environment = %w[ALFRED_WORKFLOWS_PREFERENCES ALFRED_WORKFLOWS_BACKUP_DIR ALFRED_WORKFLOWS_MIGRATE].to_h { |key| [key, ENV[key]] }
    ENV["ALFRED_WORKFLOWS_PREFERENCES"] = (@tmp/"synced prefs/Alfred.alfredpreferences").to_s
    ENV["ALFRED_WORKFLOWS_BACKUP_DIR"] = (@tmp/"backups").to_s
    ENV.delete("ALFRED_WORKFLOWS_MIGRATE")
    @staged = @tmp/"stage"
    write_workflow(@staged)
  end

  def teardown
    @environment.each { |key, value| value ? ENV[key] = value : ENV.delete(key) }
    FileUtils.rm_rf(@tmp)
  end

  def write_workflow(folder, bundle_id: BUNDLE_ID, **extra)
    folder.mkpath
    info = {
      "name" => "Example", "bundleid" => bundle_id, "version" => "1.0",
      "objects" => [{ "uid" => "hotkey", "type" => "alfred.workflow.trigger.hotkey", "config" => { "hotkey" => 0 } }]
    }.merge(extra.transform_keys(&:to_s))
    AlfredWorkflows.write_plist(folder/"info.plist", info)
    (folder/"script.sh").write("echo example\n")
    folder
  end

  def unmanaged
    AlfredWorkflows.preferences_path/"workflows/user.workflow.EXAMPLE"
  end

  def target
    AlfredWorkflows.workflow_path(TOKEN)
  end

  def prepare
    AlfredWorkflows.prepare(@staged, token: TOKEN, bundle_id: BUNDLE_ID)
  end

  def test_preferences_override_supports_spaces
    assert_equal @tmp/"synced prefs/Alfred.alfredpreferences", AlfredWorkflows.preferences_path
    assert_equal AlfredWorkflows.preferences_path/"workflows/homebrew.workflow.alfred-example", target
  end

  def test_invalid_tokens_cannot_escape_preferences
    ["../bad", "alfred-../../bad", "bad", "alfred-Foo", "alfred-"].each do |token|
      assert_raises(ArgumentError) { AlfredWorkflows.workflow_path(token) }
    end
  end

  def test_file_url_encodes_spaces_hash_and_percent
    assert_equal "file:///tmp/word%20complete%20%23%25/info.plist", AlfredWorkflows.file_url("/tmp/word complete #%/info.plist")
  end

  def test_new_install_does_not_modify_preferences
    assert_nil prepare
    refute AlfredWorkflows.preferences_path.exist?
    refute (@tmp/"backups").exist?
  end

  def test_wrong_archive_bundle_id_is_rejected
    write_workflow(@staged, bundle_id: "org.other.workflow")
    assert_raises(RuntimeError) { prepare }
    refute (@tmp/"backups").exist?
  end

  def test_manual_install_requires_explicit_migration
    write_workflow(unmanaged)
    before = AlfredWorkflows.fingerprint(unmanaged)
    error = assert_raises(RuntimeError) { prepare }
    assert_includes error.message, "ALFRED_WORKFLOWS_MIGRATE=1"
    assert_equal before, AlfredWorkflows.fingerprint(unmanaged)
    refute (@tmp/"backups").exist?
  end

  def test_migration_backs_up_and_preserves_private_configuration
    ENV["ALFRED_WORKFLOWS_MIGRATE"] = "1"
    write_workflow(unmanaged, variables: { "private_key" => "test-secret" }, disabled: true,
      objects: [{ "uid" => "hotkey", "type" => "alfred.workflow.trigger.hotkey", "config" => { "hotkey" => 42, "hotmod" => 123 } }])
    AlfredWorkflows.write_plist(unmanaged/"prefs.plist", { "token" => "test-secret" })
    state = prepare
    assert state[:retire]
    assert unmanaged.directory?, "preflight must leave the original installed"
    assert_equal AlfredWorkflows.fingerprint(unmanaged), AlfredWorkflows.fingerprint(state[:backup]/"original")
    info = AlfredWorkflows.read_plist(@staged/"info.plist")
    assert_equal({ "private_key" => "test-secret" }, info["variables"])
    assert_equal true, info["disabled"]
    assert_equal 42, info["objects"].first["config"]["hotkey"]
    assert_equal({ "token" => "test-secret" }, AlfredWorkflows.read_plist(@staged/"prefs.plist"))
    assert_equal 0700, state[:backup].stat.mode & 0777

    target.parent.mkpath
    FileUtils.cp_r(@staged, target)
    capture_io { AlfredWorkflows.finish_migration(state) }
    refute unmanaged.exist?
    assert (state[:backup]/"retired/info.plist").file?
    assert target.directory?
  end

  def test_original_is_not_retired_if_installation_fails
    ENV["ALFRED_WORKFLOWS_MIGRATE"] = "1"
    write_workflow(unmanaged)
    state = prepare
    capture_io { assert_raises(RuntimeError) { AlfredWorkflows.finish_migration(state) } }
    assert unmanaged.directory?
    assert (state[:backup]/"original/info.plist").file?
  end

  def test_original_is_not_retired_if_it_changes
    ENV["ALFRED_WORKFLOWS_MIGRATE"] = "1"
    write_workflow(unmanaged)
    state = prepare
    target.parent.mkpath
    FileUtils.cp_r(@staged, target)
    (unmanaged/"script.sh").write("echo changed\n")
    capture_io { assert_raises(RuntimeError) { AlfredWorkflows.finish_migration(state) } }
    assert unmanaged.directory?
    assert target.directory?
  end

  def test_multiple_manual_copies_are_rejected
    ENV["ALFRED_WORKFLOWS_MIGRATE"] = "1"
    write_workflow(unmanaged)
    write_workflow(unmanaged.parent/"user.workflow.DUPLICATE")
    assert_raises(RuntimeError) { prepare }
    refute (@tmp/"backups").exist?
  end

  def test_unrelated_managed_target_is_rejected
    write_workflow(target, bundle_id: "org.other.workflow")
    assert_raises(RuntimeError) { prepare }
    assert_equal "org.other.workflow", AlfredWorkflows.read_plist(target/"info.plist")["bundleid"]
  end

  def test_managed_reinstall_preserves_settings_without_migration_flag
    write_workflow(target, variables: { "setting" => "kept" })
    state = prepare
    refute state[:retire]
    assert_equal({ "setting" => "kept" }, AlfredWorkflows.read_plist(@staged/"info.plist")["variables"])
    capture_io { AlfredWorkflows.finish_migration(state) }
    assert target.directory?
  end

  def test_reinstall_restores_configuration_after_homebrew_removes_old_artifact
    write_workflow(target, variables: { "setting" => "kept across reinstall" })
    AlfredWorkflows.write_plist(target/"prefs.plist", { "private_setting" => "test" })
    capture_io { AlfredWorkflows.run_cli(["save", "--token", TOKEN, "--bundle-id", BUNDLE_ID]) }
    FileUtils.rm_r(target)
    state = prepare
    refute state[:retire]
    assert_equal({ "setting" => "kept across reinstall" }, AlfredWorkflows.read_plist(@staged/"info.plist")["variables"])
    assert_equal({ "private_setting" => "test" }, AlfredWorkflows.read_plist(@staged/"prefs.plist"))
    assert (state[:backup]/"original/info.plist").file?
  end

  def test_uninstall_backup_refuses_an_unrelated_bundle
    write_workflow(target, bundle_id: "org.other.workflow")
    assert_raises(RuntimeError) { AlfredWorkflows.remember_configuration(TOKEN, BUNDLE_ID) }
    refute (@tmp/"backups").exist?
  end

  def test_configuration_pointer_cannot_escape_backup_folder
    write_workflow(target)
    directory = AlfredWorkflows.backup_directory/"configuration"
    directory.mkpath
    (directory/"#{TOKEN}.json").write(JSON.generate(backup: target.parent.to_s, bundle_id: BUNDLE_ID))
    assert_raises(StandardError) { AlfredWorkflows.saved_configuration(TOKEN, BUNDLE_ID) }
  end

  def test_meta_workflows_are_not_touched
    meta = unmanaged.parent/"fb.workflows.bunnylol"
    write_workflow(meta, bundle_id: "fb.workflows.bunnylol")
    before = AlfredWorkflows.fingerprint(meta)
    assert_nil prepare
    assert_equal before, AlfredWorkflows.fingerprint(meta)
  end

  def test_local_source_is_copied_and_remains_version_controlled
    before = AlfredWorkflows.fingerprint(SOURCE)
    stage = AlfredWorkflows.stage_source(SOURCE, @tmp/"local-stage")
    assert_equal before, AlfredWorkflows.fingerprint(stage)
    FileUtils.mv(stage, @tmp/"installed")
    assert_equal before, AlfredWorkflows.fingerprint(SOURCE)
    assert (SOURCE/"info.plist").file?
    assert (@tmp/"installed/fuzzy.py").file?
    refute (@tmp/"installed/fuzzy.py").symlink?
  end

  def test_stow_file_links_are_copied_not_installed_as_links
    source = @tmp/"linked-source"
    source.mkpath
    SOURCE.children.each { |child| File.symlink(child, source/child.basename) }
    stage = AlfredWorkflows.stage_source(source, @tmp/"linked-stage")
    assert_equal AlfredWorkflows.fingerprint(SOURCE), AlfredWorkflows.fingerprint(stage)
    refute (stage/"info.plist").symlink?
  end

  def test_archive_cli_stages_and_finishes_migration
    ENV["ALFRED_WORKFLOWS_MIGRATE"] = "1"
    write_workflow(unmanaged, variables: { "setting" => "preserved" })
    (@staged/"alfred-helper.rb").write("helper stays outside workflow")
    AlfredWorkflows.run_cli(["stage", "--staged-path", @staged.to_s, "--token", TOKEN, "--bundle-id", BUNDLE_ID])
    assert (@staged/"alfred-workflow/info.plist").file?
    refute (@staged/"alfred-workflow/alfred-helper.rb").exist?
    state_file = @staged/"alfred-migration.json"
    assert_equal 0600, state_file.stat.mode & 0777
    assert unmanaged.directory?
    target.parent.mkpath
    FileUtils.mv(@staged/"alfred-workflow", target)
    capture_io { AlfredWorkflows.run_cli(["finish", "--state", state_file.to_s]) }
    refute unmanaged.exist?
    assert_equal({ "setting" => "preserved" }, AlfredWorkflows.read_plist(target/"info.plist")["variables"])
  end

  def test_archive_can_contain_its_own_workflow_directory
    (@staged/"workflow").mkpath
    (@staged/"workflow/library.php").write("<?php // bundled library\n")
    folder = AlfredWorkflows.stage_archive(@staged)
    assert (folder/"info.plist").file?
    assert (folder/"workflow/library.php").file?
  end

  def test_local_source_cli_runs_as_a_separate_process
    helper = Pathname.new(__dir__).parent/"homebrew/casks/thalesmello/homebrew-alfred-workflows/lib/alfred.rb"
    staged = @tmp/"local-cli"
    staged.mkpath
    before = AlfredWorkflows.fingerprint(SOURCE)
    output, error, status = Open3.capture3(
      "/usr/bin/ruby", helper.to_s, "stage", "--staged-path", staged.to_s,
      "--token", "alfred-word-complete", "--bundle-id", "me.thalesmello.alfred.wordcomplete", "--source", SOURCE.to_s
    )
    assert status.success?, "#{output} #{error}"
    assert (staged/"alfred-workflow/info.plist").file?
    assert_equal before, AlfredWorkflows.fingerprint(SOURCE)
    assert_nil JSON.parse((staged/"alfred-migration.json").read)
  end

  def test_local_source_does_not_copy_machine_preferences_or_cache
    source = @tmp/"local-source"
    write_workflow(source)
    AlfredWorkflows.write_plist(source/"prefs.plist", { "secret" => "test" })
    (source/"__pycache__").mkpath
    (source/".DS_Store").write("ignored")
    stage = AlfredWorkflows.stage_source(source, @tmp/"clean-stage")
    refute (stage/"prefs.plist").exist?
    refute (stage/"__pycache__").exist?
    refute (stage/".DS_Store").exist?
  end
end
