# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

Capital Tracker is a local-first monthly net-worth tracker (not a transaction ledger). A single Go binary runs a loopback HTTP server, serves the embedded frontend and stores data in SQLite. The frontend is plain HTML/CSS/JavaScript ES modules with no framework, bundler or build step. Node.js and Python are development-only (tests, formatting, release tooling).

Deeper references: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (invariants), [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) (build, CI, release), [docs/API.md](docs/API.md) (routes), [docs/TEST_COVERAGE.md](docs/TEST_COVERAGE.md) (browser scenarios).

## Commands

Requires Go 1.27.3+, Node.js 22+, Python 3.10+.

```sh
npm ci                      # once
npm run check               # everything except browser tests; never modifies files
npm run format              # gofmt + Prettier (needs ripgrep)
npm run test:ui             # builds the binary, then runs Playwright (all projects)
npm run security:check      # govulncheck + npm audit (needs network)

go build -o CapitalTracker ./cmd/capital-tracker
./CapitalTracker --demo --no-browser     # isolated fictional data, http://127.0.0.1:8765
```

`npm run check` runs: gofmt check, `go mod tidy -diff`, `go mod verify`, `go vet`, `go test -count=1 ./...`, `node --check` on every `web/**/*.js`, `npm test`, Prettier check, and the Python update-agent tests. CI additionally runs `python -m unittest discover -s tests -p '*release*test.py'`.

Running a single test:

```sh
go test ./internal/storage -run TestName
node --test tests/format.test.mjs
npm run test:ui -- --project=chromium tests/ui/auth.spec.cjs -g "part of title"
```

Browsers for local UI runs: `npx playwright install chromium webkit`. Playwright projects are `chromium`, `webkit`, plus `iphone`/`android` which only run a few specs (see [playwright.config.cjs](playwright.config.cjs)). Traces of failures land in `test-results/`.

When running the app manually against anything other than throwaway data, use `--demo` or `--data-dir <temp dir>`; the default data dir is the user's real finance database.

## Layout

| Path | Role |
| --- | --- |
| `cmd/capital-tracker/` | CLI (`backup`, `hash-password`, `generate-totp`, `--version`, `--demo`), listener, OS lock, shutdown |
| `internal/httpapi/` | Routes (one `registerX` per domain file, wired in `handler.go`), JSON helpers, auth/TOTP, security middleware, static serving |
| `internal/storage/` | SQLite access, embedded migrations, transactions, backups, JSON import/export (`transfer.go`) |
| `internal/finance/` | Exact money/FX arithmetic and validation |
| `internal/demo/`, `internal/buildinfo/`, `internal/updateagent/` | Demo fixture, version constant, host update-agent client |
| `web/` | Embedded frontend (`embed.go`); `js/app.js` wiring, `router.js` navigation, one module per screen, `*-actions.js` for mutations |
| `tests/*.test.mjs` | Node unit tests for frontend modules and repo consistency (CI workflow, README gallery) |
| `tests/ui/*.spec.cjs` | Playwright scenarios; `helpers.cjs` starts a real server with a temp database per test |
| `tests/*_test.py`, `scripts/*.py` | Release packaging/versioning and host update agent |

Authentication is off by default (local mode). It turns on when any of `CAPITAL_TRACKER_USERNAME`, `CAPITAL_TRACKER_PASSWORD_HASH`, `CAPITAL_TRACKER_PUBLIC_ORIGIN`, `CAPITAL_TRACKER_TOTP_SECRET` is set, which switches the handler chain to `secureRequests` + `Auth.protect`.

## Invariants to preserve

- Money is integer minor units; FX rates are fixed-point integers scaled by 10^8, meaning "1 EUR = X foreign". Totals use `math/big` rationals and round once to EUR cents, ties away from zero. No `float64` or JS `Number` arithmetic on persisted amounts.
- A missing balance row means unknown, not zero. Incomplete months yield no reliable total or month-on-month change.
- Each month keeps its own FX snapshot; nothing may silently revalue history (new quotes, group moves, archive/restore, restart, export/import).
- `PUT /api/months/{month}` is a full transactional replacement; omitted entries are deleted on purpose.
- The browser is untrusted: all validation that matters lives in Go. Frontend validation is UX only.
- Security model: bind `127.0.0.1` only, Host/Origin checks, and mutations require the `X-Capital-Tracker: 1` header. Do not weaken these.
- SQLite runs on a single connection with serialized writes. When both locks are needed, take the backup mutex before the write mutex.

## Things that must change together

- Schema change: add the next contiguous `internal/storage/migrations/NNN_name.sql` (currently up to 008). Never edit a released migration. If exported data changes, bump `SchemaVersion` in `internal/storage/transfer.go` (currently 8) and keep older versions importable.
- New or renamed frontend file: `web/embed.go` embed patterns, the `STATIC` list and `CACHE_NAME` in `web/sw.js` (bump the cache name on every frontend change).
- User-visible strings go in `web/js/i18n/en.js`; the UI is English only.
- Playwright version: `package-lock.json` must match the `mcr.microsoft.com/playwright:vX-noble` image tag in the CI and release workflows (`tests/ci-workflows.test.mjs` enforces it).
- The app version lives only in `internal/buildinfo/buildinfo.go` and is bumped by the manual Release workflow, not by hand.
- Interface, storage or UX changes need the matching `docs/` file updated. A schema bump touches `docs/DEVELOPMENT.md`, `docs/API.md` and `docs/USER_GUIDE.md`.

## Conventions

- No new frameworks, TypeScript, ORM or runtime npm dependencies without explicit discussion.
- Every bug fix gets a regression test; destructive paths are tested on isolated data.
- Prettier with single quotes for `web/` and `tests/`; `gofmt` for Go.
- Commit messages follow Conventional Commits (`feat:`, `fix:`, `test:`, `ci:`, `docs:`, `chore(release):`). Work on branches with PRs against `master`; builds and releases are manual workflows.
