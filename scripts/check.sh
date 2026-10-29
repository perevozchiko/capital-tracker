#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Check Go formatting"
# Legacy files predating the release-system change need a separate formatting pass.
# Do not hide formatting issues in new or modified files. Remove entries when reformatted.
legacy_unformatted=(
  cmd/capital-tracker/lock_unix_test.go
  internal/finance/finance.go
  internal/finance/finance_test.go
  internal/httpapi/month_delete_test.go
  internal/httpapi/static_test.go
  internal/storage/clear.go
  internal/storage/clear_test.go
  internal/storage/month_delete_test.go
  internal/storage/store.go
  internal/storage/store_test.go
)
unformatted="$(gofmt -l .)"
unapproved=()
while IFS= read -r path; do
  [[ -z "$path" ]] && continue
  known=false
  for old in "${legacy_unformatted[@]}"; do
    if [[ "$path" == "$old" ]]; then known=true; break; fi
  done
  if [[ "$known" == false ]]; then unapproved+=("$path"); fi
done <<< "$unformatted"
if (( ${#unapproved[@]} > 0 )); then
  printf 'Unformatted Go files:\n%s\n' "${unapproved[@]}" >&2
  echo "Run: gofmt -w ." >&2
  exit 1
fi
if [[ -n "$unformatted" ]]; then
  echo "Warning: known legacy formatting debt remains (${#legacy_unformatted[@]} files)."
fi

echo "==> Check go.mod/go.sum without modifying them"
go mod tidy -diff
go mod verify

echo "==> Go static analysis"
go vet ./...

echo "==> Go tests"
go test -count=1 ./...

echo "==> JavaScript syntax and tests"
node --check web/js/app.js
node --check web/js/dialogs.js
node --check web/js/numbers.js
node --experimental-default-type=module --test tests/*.test.mjs

echo "All checks passed."
