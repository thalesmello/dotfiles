# frozen_string_literal: true

require "digest"
require "fileutils"
require "json"
require "open3"
require "optparse"
require "pathname"
require "securerandom"
require "tempfile"
require "uri"

# Shared by the casks in this local tap. Reading a cask does not change Alfred
# preferences; staging, backups, and migration happen only during installation.
module AlfredWorkflows
  TAP_NAME = "thalesmello/alfred-workflows"
  STAGED_WORKFLOW = "alfred-workflow"
  TOKEN_PATTERN = /\Aalfred-[a-z0-9]+(?:-[a-z0-9]+)*\z/
  USER_CONFIG_KEYS = %w[keyword withspace hotkey hotmod hotstring].freeze

  module_function

  # Homebrew 7 preserves HOMEBREW_* environment variables when re-executing.
  # The short names remain useful when invoking this helper directly in tests.
  def setting(name)
    ENV["HOMEBREW_ALFRED_WORKFLOWS_#{name}"] || ENV["ALFRED_WORKFLOWS_#{name}"]
  end

  def preferences_path
    override = setting("PREFERENCES")
    return Pathname.new(File.expand_path(override)) if override && !override.empty?

    sync, _error, status = Open3.capture3(
      "/usr/bin/defaults", "read", "com.runningwithcrayons.Alfred-Preferences", "syncfolder"
    )
    base = if status.success? && !sync.strip.empty?
      File.expand_path(sync.strip)
    else
      File.join(Dir.home, "Library", "Application Support", "Alfred")
    end
    Pathname.new(base)/"Alfred.alfredpreferences"
  end

  def workflow_path(token)
    validate_token!(token)
    preferences_path/"workflows"/"homebrew.workflow.#{token}"
  end

  def validate_token!(token)
    raise ArgumentError, "Invalid Alfred cask token: #{token.inspect}" unless TOKEN_PATTERN.match?(token)
  end

  def read_plist(path)
    output, error, status = Open3.capture3(
      "/usr/bin/plutil", "-convert", "json", "-o", "-", "--", path.to_s
    )
    raise "Cannot read plist #{path}: #{error.strip} #{output.strip}" unless status.success?

    JSON.parse(output)
  end

  def write_plist(path, value)
    path = Pathname.new(path)
    Tempfile.create(["alfred-workflow-", ".json"], path.dirname.to_s) do |json|
      json.write(JSON.generate(value))
      json.flush
      output, error, status = Open3.capture3(
        "/usr/bin/plutil", "-convert", "xml1", "-o", path.to_s, "--", json.path
      )
      raise "Cannot write plist #{path}: #{error.strip} #{output.strip}" unless status.success?
    end
  end

  def matching_workflows(bundle_id)
    directory = preferences_path/"workflows"
    begin
      return [] unless File.stat(directory).directory?
    rescue Errno::ENOENT, Errno::ENOTDIR
      return []
    end

    directory.children.sort.select do |folder|
      info = folder/"info.plist"
      next false unless folder.directory? && info.file?

      read_plist(info)["bundleid"] == bundle_id
    end
  end

  def file_url(path)
    "file://#{URI::DEFAULT_PARSER.escape(File.expand_path(path.to_s), /[^a-zA-Z0-9\-._~\/]/)}"
  end

  # Downloading info.plist satisfies Homebrew's URL requirement for a local
  # cask. The install preflight copies ALL editable source files into staging.
  # Never give artifact() the tracked source directory: Homebrew moves artifacts.
  def stage_source(source, staged_path)
    source = Pathname.new(source)
    target = Pathname.new(staged_path)/STAGED_WORKFLOW
    raise "Missing local workflow source: #{source}" unless (source/"info.plist").file?
    raise "Local workflow staging path already exists: #{target}" if target.exist? || target.symlink?

    target.mkpath
    source.children.sort.each do |child|
      next if [".DS_Store", "__pycache__", "prefs.plist"].include?(child.basename.to_s)

      # Stow can create individual file links as well as folded directory links.
      # Dereference each top-level link so installed files are independent copies.
      FileUtils.cp_r(child.realpath, target/child.basename)
    end
    target
  end

  def preserve_configuration(source, staged)
    previous = read_plist(source/"info.plist")
    incoming = read_plist(staged/"info.plist")
    %w[variables disabled].each do |key|
      incoming[key] = previous[key] if previous.key?(key)
    end

    old_objects = Array(previous["objects"]).each_with_object({}) do |object, objects|
      objects[object["uid"]] = object
    end
    Array(incoming["objects"]).each do |object|
      old = old_objects[object["uid"]]
      next unless old && old["type"] == object["type"]

      old_config = old["config"] || {}
      object["config"] ||= {}
      if object["type"] == "alfred.workflow.trigger.hotkey"
        object["config"] = old_config
      else
        USER_CONFIG_KEYS.each do |key|
          object["config"][key] = old_config[key] if old_config.key?(key)
        end
      end
    end
    write_plist(staged/"info.plist", incoming)
    FileUtils.cp(source/"prefs.plist", staged/"prefs.plist") if (source/"prefs.plist").file?
  end

  def fingerprint(folder)
    digest = Digest::SHA256.new
    Pathname.new(folder).glob("**/*", File::FNM_DOTMATCH).sort.each do |file|
      next if [".", ".."].include?(file.basename.to_s)
      relative = file.relative_path_from(folder).to_s
      digest.update(relative + "\0")
      if file.symlink?
        digest.update("link\0" + file.readlink.to_s)
      elsif file.file?
        digest.update("file\0")
        File.open(file, "rb") do |io|
          while (chunk = io.read(1024 * 1024))
            digest.update(chunk)
          end
        end
      else
        digest.update("directory\0")
      end
    end
    digest.hexdigest
  end

  def backup_directory
    base = setting("BACKUP_DIR")
    base = File.join(Dir.home, "Library", "Application Support", "Alfred Workflow Backups") if !base || base.empty?
    Pathname.new(File.expand_path(base))
  end

  def backup_workflow(source, token)
    backup = backup_directory/"#{Time.now.utc.strftime('%Y%m%dT%H%M%SZ')}-#{SecureRandom.hex(4)}"/token
    FileUtils.mkdir_p(backup, mode: 0700)
    FileUtils.chmod(0700, backup.parent)
    FileUtils.chmod(0700, backup)
    FileUtils.cp_r(source, backup/"original")
    original_fingerprint = fingerprint(source)
    unless fingerprint(backup/"original") == original_fingerprint
      raise "Workflow changed during backup: #{source}. Nothing was removed; retry installation."
    end
    { source: source, backup: backup, fingerprint: original_fingerprint }
  end

  def remember_configuration(token, bundle_id)
    target = workflow_path(token)
    return unless (target/"info.plist").file?
    unless read_plist(target/"info.plist")["bundleid"] == bundle_id
      raise "Refusing to back up unrelated workflow at #{target}"
    end

    state = backup_workflow(target, token)
    directory = backup_directory/"configuration"
    FileUtils.mkdir_p(directory, mode: 0700)
    FileUtils.chmod(0700, directory)
    Tempfile.create([token, ".json"], directory.to_s) do |file|
      file.write(JSON.generate(backup: state[:backup].to_s, bundle_id: bundle_id))
      file.flush
      File.rename(file.path, directory/"#{token}.json")
    end
    puts "Alfred workflow backup: #{state[:backup]}"
  end

  def saved_configuration(token, bundle_id)
    file = backup_directory/"configuration"/"#{token}.json"
    return nil unless file.file?

    record = JSON.parse(file.read)
    backup = Pathname.new(record.fetch("backup"))
    source = backup/"original"
    unless source.realpath.ascend.any? { |parent| parent == backup_directory.realpath } &&
           record["bundle_id"] == bundle_id && read_plist(source/"info.plist")["bundleid"] == bundle_id
      raise "Invalid configuration backup for #{token}: #{file}"
    end
    { source: source, backup: backup }
  end

  def prepare(staged, token:, bundle_id:)
    validate_token!(token)
    staged = Pathname.new(staged)
    unless read_plist(staged/"info.plist")["bundleid"] == bundle_id
      raise "Archive bundle ID does not match #{token}: expected #{bundle_id}"
    end

    target = workflow_path(token)
    if target.exist? || target.symlink?
      unless target.directory? && !target.symlink? && (target/"info.plist").file? && read_plist(target/"info.plist")["bundleid"] == bundle_id
        raise "Refusing to replace unrelated workflow at #{target}"
      end
    end
    matches = matching_workflows(bundle_id)
    unmanaged = matches.reject { |folder| folder == target }
    if unmanaged.length > 1
      raise "Multiple installed copies of #{bundle_id}; resolve duplicates before installing #{token}"
    end
    if !unmanaged.empty? && setting("MIGRATE") != "1"
      raise "#{token} is already installed manually. Quit Alfred, then rerun with HOMEBREW_ALFRED_WORKFLOWS_MIGRATE=1 to back up and migrate it."
    end
    if unmanaged.any?(&:symlink?)
      raise "Refusing to migrate a symlinked workflow: #{unmanaged.first}"
    end
    if !unmanaged.empty? && target.exist?
      raise "Managed and unmanaged copies both exist for #{bundle_id}; resolve duplicates before installing"
    end

    existing = unmanaged.first || (target if target.exist?)
    state = existing ? backup_workflow(existing, token) : saved_configuration(token, bundle_id)
    return nil unless state

    preserve_configuration(state[:source], staged)
    state.merge(target: target, bundle_id: bundle_id, retire: !unmanaged.empty?)
  end

  def finish_migration(state)
    return unless state
    puts "Alfred workflow backup: #{state[:backup]}"
    return unless state[:retire]

    target = state[:target]
    unless (target/"info.plist").file? && read_plist(target/"info.plist")["bundleid"] == state[:bundle_id]
      raise "New workflow installation is missing; original workflow was not moved"
    end
    unless fingerprint(state[:source]) == state[:fingerprint]
      raise "Original workflow changed during installation. Both copies remain; backup: #{state[:backup]}"
    end
    # Only retire the original AFTER Homebrew installs the replacement. A failed
    # download/preflight/artifact step leaves the original workflow untouched.
    FileUtils.mv(state[:source], state[:backup]/"retired")
  end

  def stage_archive(staged_path)
    staged_path = Pathname.new(staged_path)
    target = staged_path/STAGED_WORKFLOW
    raise "Workflow staging path already exists: #{target}" if target.exist? || target.symlink?

    target.mkpath
    staged_path.children.each do |child|
      next if child == target || %w[alfred-helper.rb alfred-migration.json].include?(child.basename.to_s)

      FileUtils.mv(child, target/child.basename)
    end
    target
  end

  def install(dsl, bundle_id:, source: nil)
    token = dsl.token
    staged_path = dsl.staged_path
    helper = staged_path/"alfred-helper.rb"
    state_file = staged_path/"alfred-migration.json"
    helper_content = File.read(__FILE__)
    environment = {
      "HOMEBREW_ALFRED_WORKFLOWS_PREFERENCES" => preferences_path.to_s,
      "HOMEBREW_ALFRED_WORKFLOWS_BACKUP_DIR" => backup_directory.to_s,
      "HOMEBREW_ALFRED_WORKFLOWS_MIGRATE" => setting("MIGRATE") || "0"
    }
    writable_paths = [preferences_path.to_s, backup_directory.to_s]
    writable_paths << source.to_s if source
    stage_args = [helper.to_s, "stage", "--staged-path", staged_path.to_s, "--token", token, "--bundle-id", bundle_id]
    stage_args += ["--source", source.to_s] if source

    dsl.artifact(STAGED_WORKFLOW, target: workflow_path(token).to_s)
    # Homebrew 7 uses declarative install steps instead of Ruby flight blocks.
    # Copy the helper into staging so steps do not need to read tap Ruby files
    # from the user's dotfiles directory. Mark each `run` step with
    # `sudo => "if_needed"` so Homebrew routes it to the parent `brew` process
    # (keeping TCC access to `~/Library/CloudStorage` for Google Drive-synced
    # Alfred preferences instead of disclaiming TCC in `utils/disclaim.rb`),
    # while `requires_sudo?` remains false and `run_serialised_command` still
    # executes without sudo.
    dsl.preflight_steps do
      write_file "alfred-helper.rb", helper_content
      run "/usr/bin/ruby", args: stage_args, env: environment,
          writable_paths: writable_paths, print_stdout: true
      @steps.last["sudo"] = "if_needed"
    end
    dsl.postflight_steps do
      run "/usr/bin/ruby", args: [helper.to_s, "finish", "--state", state_file.to_s],
          env: environment, writable_paths: writable_paths, print_stdout: true
      @steps.last["sudo"] = "if_needed"
    end
    # Homebrew removes the previous artifact before reinstall/upgrade preflight.
    # Save live configuration before removal; the next install can restore it.
    dsl.uninstall_preflight_steps do
      write_file "alfred-helper.rb", helper_content
      run "/usr/bin/ruby", args: [helper.to_s, "save", "--token", token, "--bundle-id", bundle_id],
          env: environment, writable_paths: writable_paths, print_stdout: true
      @steps.last["sudo"] = "if_needed"
    end
  end

  def run_cli(arguments)
    action = arguments.shift
    options = {}
    OptionParser.new do |parser|
      parser.on("--staged-path PATH") { |value| options[:staged_path] = Pathname.new(value) }
      parser.on("--token TOKEN") { |value| options[:token] = value }
      parser.on("--bundle-id ID") { |value| options[:bundle_id] = value }
      parser.on("--source PATH") { |value| options[:source] = Pathname.new(value) }
      parser.on("--state PATH") { |value| options[:state] = Pathname.new(value) }
    end.parse!(arguments)
    raise ArgumentError, "Unexpected arguments: #{arguments.join(' ')}" unless arguments.empty?

    case action
    when "stage"
      staged_path = options.fetch(:staged_path)
      stage = if options[:source]
        stage_source(options[:source], staged_path)
      else
        stage_archive(staged_path)
      end
      state = prepare(stage, token: options.fetch(:token), bundle_id: options.fetch(:bundle_id))
      File.write(staged_path/"alfred-migration.json", JSON.generate(state), mode: "w", perm: 0600)
    when "save"
      remember_configuration(options.fetch(:token), options.fetch(:bundle_id))
    when "finish"
      state = JSON.parse(options.fetch(:state).read)
      if state
        state = state.transform_keys(&:to_sym)
        %i[source backup target].each { |key| state[key] = Pathname.new(state.fetch(key)) }
      end
      finish_migration(state)
    else
      raise ArgumentError, "Expected stage, save, or finish"
    end
  end
end

if $PROGRAM_NAME == __FILE__
  begin
    AlfredWorkflows.run_cli(ARGV)
  rescue StandardError => error
    warn "Alfred workflow installation failed: #{error.message}"
    exit 1
  end
end
