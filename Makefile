.PHONY: all test-all test-homebrew test-macos macos

all: test-all

test-all:
	ruby tests/alfred_workflows_test.rb
	ruby tests/macos_settings_test.rb

test-homebrew: test-all

test-macos:
	ruby tests/macos_settings_test.rb

macos:
	sh ./scripts/macos_settings.sh
