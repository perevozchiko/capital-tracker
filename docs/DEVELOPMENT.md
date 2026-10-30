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

## GitHub Actions (one automatic runner)

The repository keeps **four workflows**:

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| **CI** | Pushes to `master`, PRs against `master`, or manual | One Ubuntu job runs Go tests/vet, JavaScript checks, formatting, release-planner tests and real Playwright/Chromium UI tests |
| **Build Capital Tracker** | Manual only | Build development binaries on chosen platforms |
| **Release** | Manual only | Validate, build, verify, tag and publish a versioned release |
| **Capture demo screenshots** | Manual only | Capture the real demo UI into `docs/screenshots/` |

The former separate `Browser UI tests` workflow was redundant: it ran much of the same suite as CI and allocated an additional runner on every push. It has been consolidated into **CI**, including failed-browser-test trace artifacts. Older in-flight CI runs on the same branch or pull request are cancelled when replaced by a newer commit; completed history is retained by GitHub according to repository retention settings. Deleting historical runs does not change the number of runners used by future commits.

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

The suite covers navigation, settings, account and group management, monthly balances, exchange-rate loading, import/export, deletion confirmations, and mobile viewports. See the [browser coverage matrix](TEST_COVERAGE.md) for 174 scenarios, including native drag-and-drop, individual/bulk group collapse, exact input boundaries for all five currencies and long workflows across restart and data recovery, and mobile layout checks for 10-million balances in all five currencies. Deterministic FX scenarios change provider responses between loading and saving, verify independent monthly snapshots, preserve all four currencies across reload/export, and exercise partial responses, retries and save failures. A Go integration test also reopens the database and round-trips its export to verify that historical rates and totals remain unchanged.

To also run the browser against the real external currency provider (internet required):

```sh
CAPITAL_TRACKER_LIVE_RATES=1 npm run test:ui
```

This enables an additional Playwright scenario with no quote interception: the browser loads real rates through the application, saves them into a past month, reloads the page and verifies the exact saved values and history. The live scenario is skipped by default so provider outages cannot make ordinary CI nondeterministic. Test failures retain Playwright traces under `test-results/`; view one with `npx playwright show-trace <path-to-trace.zip>`. The tests do not use the normal application database. GitHub Actions runs them on pushes and pull requests.

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

Versioned releases are deliberately manual. Open **Actions → Release → Run workflow**, choose `master`. The two selectors work like those in Budget Tinker: **Version: Current, Patch, Minor or Major** (default **`current`**) and **Release stage** (default **`alpha`**, with `beta`, `rc` and `stable` also available). Then click **Run workflow**. After success, find the archives under [GitHub Releases](https://github.com/perevozchiko/capital-tracker/releases). Regular commits and merges run CI checks but never create version tags or publish releases. The separate **Build Capital Tracker** workflow remains manually runnable on development branches and can build macOS, Linux, Windows or all platforms.

**For another Alpha release, leave both defaults unchanged: `current` + `alpha`.** This advances the Alpha suffix only; it **does not** bump PATCH. Only explicitly selecting `patch`, `minor` or `major` starts a new version series.

The authoritative application version is the Go constant in `internal/buildinfo/buildinfo.go`. The workflow fetches Git tags to prevent collisions, prepares the next version commit (only if needed), validates and builds a **pinned commit**, verifies four release archives and their SHA256 checksums, and only after all required jobs pass creates the immutable version tag and GitHub Release. A failed test or build prevents publishing. If a version preparation commit succeeded but no tag was published, rerun **Current** with the same release stage to retry that exact version.

**Current** continues the MAJOR.MINOR.PATCH series: the selected prerelease stage increments automatically (`alpha.2 → alpha.3`), and advancing `alpha → beta → rc → stable` keeps the base version and resets numbering to `.1` for the new prerelease stage. Downgrading to an earlier stage of the same series is rejected. **Patch** increments PATCH; **Minor** increments MINOR and resets PATCH; **Major** increments MAJOR and resets MINOR and PATCH. For a new series, select any stage. For example, from tagged `v0.1.6-alpha.1`, **Current + Alpha** produces `v0.1.6-alpha.2`, **Current + Beta** produces `v0.1.6-beta.1`, and only **Patch + Alpha** produces `v0.1.7-alpha.1`. With no existing release tag, **Current + Stable** can publish the existing `v0.1.3`; **Current + Alpha** is correctly rejected because it would downgrade an already stable version.

**Failed upload recovery:** release archives are uploaded to GitHub Actions with one automatic retry for transient errors such as `ETIMEDOUT`. If artifact storage remains unavailable and the release fails before publication, **do not select Patch or Minor just to retry**. Instead use **Current + the same stage**, which keeps the prepared untagged version, or use GitHub's **Re-run failed jobs** for that run. No new release tag is created unless all four archives pass verification and publication succeeds.

**Version correction (October 2026):** an earlier workflow mistakenly defaulted to Patch and prepared `v0.1.6-alpha.1`, but the release failed at the macOS Intel artifact upload and never created a tag. The source version was restored to the last published `v0.1.5-alpha.1`. The next normal **Current + Alpha** release therefore becomes `v0.1.5-alpha.2` (not `v0.1.7-alpha.1`).

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

Migration scripts are embedded under [`internal/storage/migrations/`](../internal/storage/migrations/). Database identity is checked on opening, and an unknown/newer schema is rejected; a pre-migration backup is created for existing older-format databases. Schema versions 1–4 are defined; migration 2 adds account groups and account membership, and migration 3 adds independent monthly income notes. Migration 4 gives income notes names and preserves multiple entries per currency. JSON exports use version 4; versions 1–3 remain importable. [`PROGRESS.md`](../PROGRESS.md) documents verification status.
