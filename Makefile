.PHONY: all test-all test-homebrew

all: test-all

test-all:
	ruby tests/alfred_workflows_test.rb

test-homebrew: test-all
