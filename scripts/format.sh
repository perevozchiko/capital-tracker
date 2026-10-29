#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
gofmt -w .
npx --no-install prettier --write web tests package.json playwright.config.cjs
echo "Source files formatted. Run npm run check before committing."
