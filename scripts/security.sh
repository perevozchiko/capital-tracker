#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 ./...
npm audit --audit-level=low
