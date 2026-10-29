#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Check Go formatting"
unformatted="$(gofmt -l .)"
if [[ -n "$unformatted" ]]; then
  printf 'Unformatted Go files:\n%s\n' "$unformatted" >&2
  echo "Run: gofmt -w ." >&2
  exit 1
fi

echo "==> Check go.mod/go.sum without modifying them"
go mod tidy -diff
go mod verify

echo "==> Go static analysis"
go vet ./...

echo "==> Go tests"
go test -count=1 ./...

echo "==> JavaScript syntax and tests"
while IFS= read -r file; do
  node --check "$file"
done < <(find web -name '*.js' -type f)
npm test
npm run format:check

echo "All checks passed."
