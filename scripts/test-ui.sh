#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test_dir="$(mktemp -d)"
trap 'rm -rf "$test_dir"' EXIT
go build -o "$test_dir/capital-tracker" ./cmd/capital-tracker
CAPITAL_TRACKER_TEST_BINARY="$test_dir/capital-tracker" npx playwright test "$@"
