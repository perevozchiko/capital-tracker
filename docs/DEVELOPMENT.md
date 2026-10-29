# Development and Release Guide

[← Back to Capital Tracker](../README.md) · [Architecture](ARCHITECTURE.md) · [Contributing](../CONTRIBUTING.md)

## Build and run

Install Go and build (Go 1.23 or later; GitHub Actions uses Go 1.27.3):

```sh
go mod tidy
go test ./...
go vet ./...
go build -o CapitalTracker ./cmd/capital-tracker
./CapitalTracker
```

On Windows, replace `-o CapitalTracker` with `-o CapitalTracker.exe`, and launch `CapitalTracker.exe`.

The server listens on **http://127.0.0.1:8765**, opens the default browser once ready, and runs until you close the terminal or press Ctrl+C. The app only serves on the local machine; opening the URL on your phone will *not* connect to the computer. Its mobile-size UI can be tested in browser responsive device mode.

Options:

```sh
./CapitalTracker --no-browser
./CapitalTracker --port 8766 --data-dir /some/private/directory
CAPITAL_TRACKER_PORT=8766 CAPITAL_TRACKER_DATA_DIR=/some/private/directory ./CapitalTracker
./CapitalTracker backup /some/other/directory/backup.db
./CapitalTracker backup --data-dir /some/private/directory /some/other/directory/backup.db
```

Command line options override environment variables, which override defaults. The `backup` subcommand accepts `--data-dir` and the environment data directory and safely takes a consistent snapshot with SQLite `VACUUM INTO`; it refuses to replace an existing destination. Do not copy `capital.db` alone while the server is running: SQLite can keep live changes in `capital.db-wal`. Shut down the program before making manual filesystem backups, or use `backup` while it runs.

Data location: macOS `~/Library/Application Support/CapitalTracker/capital.db`; Linux `${XDG_CONFIG_HOME:-~/.config}/CapitalTracker/capital.db` and Windows the standard user configuration directory. Your data is not bundled with the executable; replacing the executable will not delete your records.

The executable is not Apple-signed/notarized; Gatekeeper may warn when launching a downloaded binary. Build locally or follow Apple's standard security confirmation procedure for software you trust.

## Screenshot capture

The README displays actual screenshots from the **fictional demo database**, not generated graphics or private account data. To regenerate them from the repository root:

```sh
python3 -m pip install playwright
python3 -m playwright install chromium
python3 scripts/capture-demo-screenshots.py
```

This launches the real Go app with isolated sample data, captures Chromium in Dark mode, and writes `docs/screenshots/dashboard.png`, `monthly-balances.png` and `accounts.png`. You can also run **Actions → Capture demo screenshots → Run workflow** on `master`: the workflow commits changed PNG files only and does not rewrite the hand-maintained README gallery.

## Download builds from GitHub Actions

Run all local source checks before committing (requires Go 1.23+ and Node.js 22+):
```sh
npm ci
npm run check
```
Browser UI tests exercise the real application in headless Chromium with an isolated temporary database per test. Install Node.js 22 or newer, Go, and the browser once, then run:

```sh
npm ci
npx playwright install chromium
npm run test:ui
```

The suite covers navigation, settings, account and group management, monthly balances, exchange-rate loading (with deterministic mocked responses), import/export, deletion confirmations, and a mobile viewport. Test failures retain Playwright traces under `test-results/`; view one with `npx playwright show-trace <path-to-trace.zip>`. The tests do not use the normal application database. GitHub Actions runs them on pushes and pull requests.

If it reports Go formatting differences, run `gofmt -w .` once and commit the formatted files. The script checks `gofmt`, `go mod tidy -diff`, `go mod verify`, `go vet`, Go tests, syntax for every JavaScript module, JavaScript unit tests and Prettier formatting. The check command never changes source files. Use `npm run format` to format Go, JavaScript, CSS and HTML sources.

**Builds are manual-only** during development: pushes, tags, and pull requests do not trigger compilation.

To request a binary, open **Actions → Build Capital Tracker → Run workflow**, select the `master` branch, and choose a `platform`:

| Selection | Runner | Downloadable artifact | Executable |
| --- | --- | --- | --- |
| `macos` (default) | macOS Apple Silicon (ARM64) | `CapitalTracker-macos-arm64` | `CapitalTracker-darwin-arm64` |
| `linux` | Linux x86-64 (AMD64) | `CapitalTracker-linux-amd64` | `CapitalTracker-linux-amd64` |
| `windows` | Windows x86-64 (AMD64) | `CapitalTracker-windows-amd64` | `CapitalTracker-windows-amd64.exe` |
| `all` | All three | All three artifacts | One per platform |

Each selected job runs unit tests, JavaScript checks, `go vet`, and a native build. The macOS job additionally smoke-tests the server, the home page, backup, and restart. After a successful run, download your artifact from that run's **Artifacts** section. Each artifact includes a SHA-256 checksum. The manual development workflow does not build macOS Intel (the Release workflow does); downloaded binaries are unsigned/unnotarized, and GitHub Releases are not published automatically.

## Release Process

Versioned releases are deliberately manual. Open **Actions → Release → Run workflow**, choose `master`, select the **Version increment** (`current`, `patch`, `minor` or `major`) and **Release stage** (`alpha`, `beta`, `rc` or `stable`), then click **Run workflow**. After success, find the archives under [GitHub Releases](https://github.com/perevozchiko/capital-tracker/releases). Regular commits and merges run CI checks but never create version tags or publish releases. The separate **Build Capital Tracker** workflow remains manually runnable on development branches and can build macOS, Linux, Windows or all platforms.

The authoritative application version is the Go constant in `internal/buildinfo/buildinfo.go`. The workflow fetches Git tags to prevent collisions, prepares the next version commit (only if needed), validates and builds a **pinned commit**, verifies four release archives and their SHA256 checksums, and only after all required jobs pass creates the immutable version tag and GitHub Release. A failed test or build prevents publishing. If a version preparation commit succeeded but no tag was published, rerun **Current** with the same release stage to retry that exact version.

**Current** continues the MAJOR.MINOR.PATCH series: the selected prerelease stage increments automatically (`alpha.2 → alpha.3`), and advancing `alpha → beta → rc → stable` keeps the base version and resets numbering to `.1` for the new prerelease stage. Downgrading to an earlier stage of the same series is rejected. **Patch** increments PATCH; **Minor** increments MINOR and resets PATCH; **Major** increments MAJOR and resets MINOR and PATCH. For a new series, select any stage. For example, starting at `v0.1.3`, choose **Patch + Alpha** for `v0.1.4-alpha.1`. With no existing release tag, **Current + Stable** can publish the existing `v0.1.3`; **Current + Alpha** is correctly rejected because it would downgrade an already stable version.

Each release includes `CapitalTracker-vX.Y.Z[-stage.N]-macos-arm64.zip`, `...-macos-amd64.zip`, `...-linux-amd64.tar.gz` and `...-windows-amd64.zip`, plus individual `.sha256` files. GitHub automatically generates release notes using `.github/release.yml` (categorized merged PRs, contributors and comparison link); Alpha, Beta and RC are prereleases while Stable is not. **Settings → About** displays the authoritative version and 8-character build commit; `CapitalTracker --version` reports the same information without opening a server or requiring Git. Release packages are not code-signed.

## Project structure

```text
cmd/capital-tracker/   Startup, CLI flags, signals and platform-specific locking
internal/buildinfo/    Authoritative version and build commit metadata
internal/demo/         Embedded fixture and isolated demo initialization
internal/finance/      Exact conversions, validation and rounding
internal/storage/      SQLite connection, migrations and domain operations
  accounts.go          Accounts, activity periods and ordering
  months.go            Monthly snapshots, balances and exchange rates
  dashboard.go         Capital history and dashboard aggregation
  settings.go          Persisted preferences
  groups.go            Account groups, assignments and subtotals
  transfer.go          Versioned JSON import and export
internal/httpapi/      Domain routes, JSON helpers, security and static serving
web/
  js/app.js            Bootstrap and browser event wiring
  js/router.js         Navigation, data refresh and page rendering
  js/*-actions.js      Account, monthly and data-management actions
  js/accounts.js       Accounts page
  js/dashboard.js      Dashboard, table and chart
  js/monthly.js        Monthly balance editor
  js/settings.js       Settings page
  js/state.js          Shared application state and collapsed groups
  js/api.js            JSON API client and request headers
  js/format.js         Exact amount parsing, display and month utilities
  js/ui.js             Shared UI controls, notifications and appearance
  js/messages.js       English message lookup
  js/i18n/en.js        English message catalog
  js/dialogs.js        Confirmation dialogs
  js/numbers.js        Exact rate parsing and balance differences
  css/app.css          Responsive layouts, components and themes
  sw.js                Network-first static asset caching
  embed.go             Assets embedded into the Go binary
tests/                JavaScript unit tests and Playwright browser scenarios
scripts/               Source checks, formatting and screenshot capture
.github/workflows/     CI, browser tests, builds, releases and screenshots
```

The interface always uses English, including dates, numbers and confirmations. Older databases and JSON snapshots with a Russian language preference remain compatible; that legacy field does not change the interface language. Account and group names entered by users are preserved.

Migration scripts are embedded under [`internal/storage/migrations/`](../internal/storage/migrations/). Database identity is checked on opening, and an unknown/newer schema is rejected; a pre-migration backup is created for existing older-format databases. Schema versions 1 and 2 are defined; migration 2 adds account groups and account membership. [`PROGRESS.md`](../PROGRESS.md) documents verification status.
