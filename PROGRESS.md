# Capital Tracker — implementation verification

- [x] Basic configuration, embedded web assets, launch, graceful shutdown
- [x] SQLite schema, migration guard, durable data directory, backup command
- [x] Accounts, history-preserving archive/restore and atomic ordering API
- [x] Monthly snapshots with transactional full replacement and completeness status
- [x] Exact multi-currency arithmetic, EUR net worth and month-on-month change
- [x] English and Russian dictionaries, preferences and Light/Dark/System theme
- [x] Accounts, monthly entry, dashboard, six-month table and history SVG chart
- [x] PWA manifest, icons and network-first static-assets service worker
- [x] Manual GitHub Actions workflow with a platform selector (macOS Apple Silicon, Linux AMD64, Windows AMD64, or all)
- [x] README and usage/build/API/backup documentation
- [x] Local financial unit tests (using offline compile stub)
- [x] Local Go static compilation and JavaScript parsing checks (using offline compile stub)
- [x] SQLite-dependent tests on real `modernc.org/sqlite` (GitHub Actions macOS runners, October 28, 2026)
- [ ] Cross-platform browser launch and UI smoke test (macOS browsers not available locally)
- [x] macOS arm64 + amd64 CI compile (prior to removal of Intel), unit tests and vet passed on commit `126e18c`
- [ ] Verify manual build artifacts for macOS Apple Silicon, Linux AMD64 and Windows AMD64 in a new workflow_dispatch run (including Linux restart and backup smoke test)
- [ ] Run scripts/check.sh locally; review gofmt output and dependency consistency
- [ ] Verify native Windows LockFileEx on a Windows runner

- [x] Serialized multi-step financial writes and added regression tests for incomplete historical months
- [x] Correct large percentage changes using exact integer strings
