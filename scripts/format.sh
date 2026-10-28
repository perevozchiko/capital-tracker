#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
gofmt -w .
echo "Go files formatted. Run scripts/check.sh before committing."
