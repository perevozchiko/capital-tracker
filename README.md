<div align="center">

<a href="https://github.com/perevozchiko/capital-tracker">
  <img src="web/icons/icon-192.png" alt="Capital Tracker application icon" width="78">
</a>

<h1>Capital Tracker</h1>

<p><strong>Know what you own. Track how it grows.</strong></p>

<p>A lightweight, local-first net-worth tracker.<br>Update your account balances once a month — without recording every purchase.</p>

<p><a href="#screenshots">Explore screenshots</a> · <a href="#quick-start">Quick start</a> · <a href="#downloads">Downloads</a> · <a href="#documentation">Documentation</a></p>

<a href="https://github.com/perevozchiko/capital-tracker/actions/workflows/ci.yml">
  <img src="https://github.com/perevozchiko/capital-tracker/actions/workflows/ci.yml/badge.svg" alt="CI status">
</a>
<a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue" alt="MIT OR Apache-2.0 license"></a>
<a href="https://github.com/perevozchiko/capital-tracker/releases"><img src="https://img.shields.io/github/v/release/perevozchiko/capital-tracker?include_prereleases&label=release" alt="Latest release, when available"></a>

<p><strong>Go + SQLite</strong> · <strong>No cloud or account required</strong> · <strong>Local data</strong> · <strong>macOS / Linux / Windows</strong></p>

</div>

Capital Tracker is independently developed open-source software. It is not affiliated with any commercial budgeting app. Your financial data stays in a SQLite database on your computer.

## Screenshots

<div align="center">

<p><strong>Real browser screenshots, not mockups.</strong> Captured in Chromium with fictional demo data and the app's Dark theme.</p>

<h3>Dashboard</h3>

<a href="https://raw.githubusercontent.com/perevozchiko/capital-tracker/master/docs/screenshots/dashboard.png">
  <img src="docs/screenshots/dashboard.png" alt="Capital Tracker dashboard: monthly net worth, history chart and balance table" width="940">
</a>

<sub><strong>Tap or click the screenshot</strong> to view it at full resolution. Use your browser's image zoom to inspect the details.</sub>

</div>

<table>
  <tr>
    <td align="center" width="50%">
      <strong>Monthly balances</strong>
    </td>
    <td align="center" width="50%">
      <strong>Accounts & groups</strong>
    </td>
  </tr>
  <tr>
    <td align="center">
      <a href="https://raw.githubusercontent.com/perevozchiko/capital-tracker/master/docs/screenshots/monthly-balances.png">
        <img src="docs/screenshots/monthly-balances.png" alt="Monthly balance editor with grouped account balances and exchange rates" width="455">
      </a>
    </td>
    <td align="center">
      <a href="https://raw.githubusercontent.com/perevozchiko/capital-tracker/master/docs/screenshots/accounts.png">
        <img src="docs/screenshots/accounts.png" alt="Account management showing groups and individual accounts" width="455">
      </a>
    </td>
  </tr>
  <tr>
    <td align="center">
      <sub>Record balances for one or several accounts at a time.</sub>
    </td>
    <td align="center">
      <sub>Organize accounts into collapsible groups.</sub>
    </td>
  </tr>
</table>

<div align="center">

<p><a href="https://raw.githubusercontent.com/perevozchiko/capital-tracker/master/docs/screenshots/dashboard.png">Dashboard full size</a> · <a href="https://raw.githubusercontent.com/perevozchiko/capital-tracker/master/docs/screenshots/monthly-balances.png">Monthly balances full size</a> · <a href="https://raw.githubusercontent.com/perevozchiko/capital-tracker/master/docs/screenshots/accounts.png">Accounts full size</a></p>

<p><a href="docs/screenshots/README.md">About these screenshots and how to regenerate them</a></p>

</div>

## What it does

- **Monthly snapshots:** save balances for one or more accounts now and finish later; unknown is different from zero.
- **Accounts and groups:** organize accounts by dragging them into collapsible groups, keep archived history, and see group subtotals in EUR.
- **Five currencies:** EUR (reporting base), USD, RSD, RUB and TRY, with month-specific FX rates entered manually or explicitly loaded on request.
- **Capital history:** a chart, multi-month balance table and change since the previous complete month.
- **Exact calculations:** integer minor units and fixed-point exchange rates; no floating-point rounding of stored money.
- **Offline-friendly UI:** desktop browser interface, responsive PWA assets, Dark/Light/System themes and English interface.
- **Your data:** portable JSON exports, full SQLite backups, intentional deletion with confirmation, and a safe fictional demo mode.

## Quick start

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

<details>
<summary><strong>What is included in the demo?</strong></summary>

The isolated sample contains 12 complete monthly snapshots (October 2025–September 2026), with fictional account balances, EUR/USD rates, savings, investments and a loan. Demo mode never opens or edits your regular database. See the [User Guide](docs/USER_GUIDE.md) for details.

</details>

<details>
<summary><strong>How private is the app?</strong></summary>

The app binds only to the local loopback interface, does not require an online account, and stores financial data in local SQLite. Optional exchange-rate lookups require an explicit user action and do not send your account balances to the provider. The SQLite database and exported JSON are not encrypted by the application; use full-disk encryption and backups for protection. See [Security](SECURITY.md).

</details>

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
