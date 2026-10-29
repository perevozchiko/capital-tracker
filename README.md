# Capital Tracker

**A simple, local-first net-worth tracker.** Enter the balances of your accounts once a month, rather than recording every purchase. See how your capital changes over time, with monthly exchange rates and exact financial arithmetic.

Capital Tracker is an independently developed open-source application. It is not affiliated with YNAB or any other commercial budgeting product. All financial data stays in a local SQLite database; no sign-up or cloud account is required.

## Screenshots

Real screenshots from Chromium, running the isolated fictional demo dataset in **Dark** mode (not mockups or personal financial records).

![Capital Tracker — Dashboard](docs/screenshots/dashboard.png)

| Monthly balances | Accounts and groups |
| --- | --- |
| ![Monthly balances — dark theme](docs/screenshots/monthly-balances.png) | ![Accounts and groups — dark theme](docs/screenshots/accounts.png) |

[See the screenshot sources and how to regenerate them](docs/screenshots/README.md).

## What it does

- **Monthly snapshots:** save balances for one or more accounts now and finish later; unknown is different from zero.
- **Accounts and groups:** organize accounts by dragging them into collapsible groups, keep archived history, and see group subtotals in EUR.
- **Five currencies:** EUR (reporting base), USD, RSD, RUB and TRY, with month-specific FX rates entered manually or explicitly loaded on request.
- **Capital history:** a chart, multi-month balance table and change since the previous complete month.
- **Exact calculations:** integer minor units and fixed-point exchange rates; no floating-point rounding of stored money.
- **Offline-friendly UI:** desktop browser interface, responsive PWA assets, Dark/Light/System themes and English interface.
- **Your data:** portable JSON exports, full SQLite backups, intentional deletion with confirmation, and a safe fictional demo mode.

## Try it

Install [Go](https://go.dev/dl/) 1.23 or newer, then clone this repository and run:

```sh
go run ./cmd/capital-tracker --demo
```

The app opens at **http://127.0.0.1:8765** in your default browser. Demo mode writes exclusively to a separate `CapitalTrackerDemo` directory. Your normal data is never loaded or replaced by the demo.

To start with your actual accounts, run without `--demo`:

```sh
go run ./cmd/capital-tracker
```

Or create a standalone executable:

```sh
go build -o CapitalTracker ./cmd/capital-tracker
./CapitalTracker
```

On Windows, use `-o CapitalTracker.exe` and run `CapitalTracker.exe`.

The executable bundles the web interface and uses only a local HTTP server. It has no production Node.js dependency. The server binds loopback only; the browser UI is **not** accessible from your phone over the LAN.

## Downloads

- [**Releases**](https://github.com/perevozchiko/capital-tracker/releases) — manually published versioned packages for macOS (Apple Silicon and Intel), Windows x64 and Linux x64 when a release has been published.
- [**Actions → Build Capital Tracker**](https://github.com/perevozchiko/capital-tracker/actions/workflows/build-macos.yml) — manually build a development binary for macOS Apple Silicon, Windows x64, Linux x64, or all three; no release is created.
- [**Actions → Release**](https://github.com/perevozchiko/capital-tracker/actions/workflows/release.yml) — manual SemVer release workflow, supporting Alpha, Beta, RC and Stable.

Downloaded binaries are currently unsigned/not notarized. Verify the attached SHA-256 checksums. Existing data is kept separately from application binaries.

## Documentation

| Guide | Contents |
| --- | --- |
| [User Guide](docs/USER_GUIDE.md) | Demo, groups, archive, balances, rates, imports, exports, backups and financial rules |
| [Architecture](docs/ARCHITECTURE.md) | Go and browser modules, data flow, SQLite migrations, exact-money invariants, security |
| [HTTP API](docs/API.md) | Endpoint list, JSON payloads, errors and same-origin requirements |
| [Development and releases](docs/DEVELOPMENT.md) | Build/run options, formatting, unit and browser tests, GitHub Actions, release versions |
| [Contributing](CONTRIBUTING.md) | Project conventions, local checks and pull requests |
| [Security](SECURITY.md) | Threat model, local data protection and vulnerability reporting |

## Development checks

Node.js 22+ is used **only for development** (Playwright and Prettier).

```sh
npm ci
npm run check
npx playwright install chromium
npm run test:ui
```

All browser tests use isolated temporary demo databases, not your personal database. `npm run format` formats Go and frontend sources; see [Development guide](docs/DEVELOPMENT.md) for details.

## License

Copyright © 2026 **perevozchiko**.

Licensed under **MIT OR Apache-2.0**, at your choice. Read the complete [MIT License](LICENSE) and [Apache License 2.0](LICENSE-APACHE). You may use, modify and redistribute the original application source, including commercially, subject to the terms of the chosen license. Third-party dependencies remain under their own licenses.

This project is provided **as is**, without warranty. It is a personal finance tracking tool, not financial advice.
