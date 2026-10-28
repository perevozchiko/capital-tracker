# Capital Tracker

A simple, local-first personal net worth tracker. Record end-of-month balances instead of individual transactions, and monitor total capital converted to EUR using **the exchange rate saved for each month**.

- Five account currencies: EUR, USD, RSD, RUB and TRY.
- Multiple independent accounts, archived history, monthly balances and manually entered monthly FX rates.
- Exact arithmetic, no binary floating point in stored balances or exchange rates.
- Dashboard with six adjacent month columns, monthly change and historical SVG chart.
- English / Russian, System / Light / Dark appearance, responsive browser UI and PWA assets.
- A single local HTTP server with embedded assets; no cloud, login, frontend build, Node.js or bank connection.

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
```

Command line options override environment variables, which override defaults. The `backup` subcommand uses the environment data directory (when supplied) and safely takes a consistent snapshot with SQLite `VACUUM INTO`; it refuses to replace an existing destination. Do not copy `capital.db` alone while the server is running: SQLite can keep live changes in `capital.db-wal`. Shut down the program before making manual filesystem backups, or use `backup` while it runs.

Data location: macOS `~/Library/Application Support/CapitalTracker/capital.db`; Linux `${XDG_CONFIG_HOME:-~/.config}/CapitalTracker/capital.db` and Windows the standard user configuration directory. Your data is not bundled with the executable; replacing the executable will not delete your records.

The executable is not Apple-signed/notarized; Gatekeeper may warn when launching a downloaded binary. Build locally or follow Apple's standard security confirmation procedure for software you trust.

## Download macOS builds

On each push to `master`, pull request and manual dispatch, GitHub Actions runs Go tests and `go vet` natively on Apple Silicon and Intel macOS, and compiles four **CGO-free** executables:

| Workflow artifact | Mac CPU | Executable |
| --- | --- | --- |
| `CapitalTracker-macos-arm64` | Apple Silicon (M1–M-series) | `CapitalTracker-darwin-arm64` |
| `CapitalTracker-macos-amd64` | Intel | `CapitalTracker-darwin-amd64` |
| `CapitalTracker-linux-amd64` | Linux x86-64 | `CapitalTracker-linux-amd64` |
| `CapitalTracker-windows-amd64` | Windows x86-64 | `CapitalTracker-windows-amd64.exe` |

Open the repository's **Actions → Build Capital Tracker → most recent successful run → Artifacts** and download the appropriate artifact. A SHA-256 checksum is included. Files are not signed or notarized. Release uploads are not automated.

## Financial semantics

Balances are **end-of-month snapshots** in the account's native currency, stored as **integer minor units** (cents, including RSD). A blank entry means unknown and is *not* zero. FX rates are **manually entered end-of-month rates**: `1 EUR = X USD / RSD / RUB / TRY` with up to eight decimals; the EUR rate is implicitly one. Monthly total = sum of each account's exact EUR-cent equivalent, rounded **once** to the nearest cent, ties away from zero for positive or negative amounts. Account figures in the table remain in their original currencies. Monthly changes compare only immediately consecutive **complete** months; percentage change is calculated from displayed rounded EUR-cent totals, and is undefined when the previous total is zero.

A month is complete only when it has at least one active account, each active account has a balance (zero is valid), and all currencies needed by active accounts have a rate. Empty months are incomplete and remain visible; missing months are not treated as zeros. There is no automatic carry-forward. Both balances and rates are replaced atomically by a `PUT` for the selected month. Omit an entry to remove it from that month. All timestamps are in UTC. Months accepted: `1900-01` through `2200-12` (including future months).

Accounts have a list of activity periods. An archived account is removed from capital totals starting with its first excluded month; previous balances are kept. A restored account gets a **new period**, not a retroactive extension. To avoid silently changing historical completeness, creating accounts, archiving and restoring must not alter any already-created month. Use a start/archive/restore month *after* the latest existing month.

Amounts in JSON are represented as **decimal strings of integer minor units**, not JavaScript numbers, to avoid loss of precision. Rates are transmitted as validated decimal strings; the server converts them to eight-place fixed-point integers. The UI accepts `.` or `,` as decimal separator and spaces as grouping separators; ambiguous three-decimal representations are rejected for rates. All capital totals are calculated by Go, not JavaScript. Chart coordinates use approximate numeric geometry, while displayed amounts use exact decimal strings.

## API

All endpoints use JSON (`Content-Type: application/json` on writes) and errors have the shape `{"error":{"code":"validation_error","field":"month"}}`. Requests that change data must supply `X-Capital-Tracker: 1`; the server enforces strict `Host` and `Origin` checks and does not enable cross-origin access. Endpoints:

| Method | Endpoint | Function |
| --- | --- | --- |
| `GET`, `POST` | `/api/accounts` | List / create accounts (`name`, `currency`, `start_month`) |
| `PATCH`, `DELETE` | `/api/accounts/{id}` | Change account name or currency (currency only before any recorded balance) / delete history-free account |
| `POST` | `/api/accounts/{id}/archive` | `{"month":"2026-11"}` |
| `POST` | `/api/accounts/{id}/restore` | `{"start_month":"2026-12"}` |
| `PUT` | `/api/accounts/reorder` | `{"ids":[1,2,3]}` full atomic order |
| `GET`, `POST` | `/api/months` | List / explicitly create empty month |
| `GET`, `PUT` | `/api/months/{YYYY-MM}` | Read / replace all balances and rates transactionally |
| `GET` | `/api/dashboard?month=YYYY-MM` | Summary, previous month and six-column table data |
| `GET` | `/api/capital/history` | Chronological complete/incomplete points |
| `GET`, `PATCH` | `/api/settings` | Read / update language and appearance |
| `GET` | `/api/meta` | App identity and version |

Example full monthly replacement:

```json
{
  "balances": [ { "account_id": 1, "amount_minor": "11720000" } ],
  "rates": [ { "currency": "RSD", "rate": "117.20" } ]
}
```

`PUT /api/months/{month}` creates the month when needed, and removes old balance/rate entries omitted from this request. `POST /api/months` creates a deliberately empty month and rejects duplicates. Never call `PUT` with an empty payload unintentionally, as that means clear the month. Requests are limited to 1 MiB.

## Project structure

```
cmd/capital-tracker/   Startup, CLI flags, signals and browser opening
internal/finance/     Exact conversions, validation and rounding
internal/storage/     SQLite schema, migrations and data operations
internal/httpapi/     Secure local REST endpoints, static file routing
web/                  Embedded HTML, CSS, JS, dictionaries, SVG and PWA assets
.github/workflows/    Go checks and macOS binary artifacts
```

Migration scripts are embedded under `internal/storage/migrations/`. Database identity is checked on opening, and an unknown/newer schema is rejected; a pre-migration backup is created for existing older-format databases. Only schema version 1 is defined currently. `PROGRESS.md` documents verification status.

## Limitations

- No remote/mobile access over the LAN; no server-independent offline editing; no automatic FX updates.
- There are no automatic backups, exports, imports, transactions or cloud sync.
- Concurrent launching on the same data directory is prevented with a lock file; after an unclean crash, verify there is no running process before manually clearing `.capital-tracker.lock`.
- Built-in browser checks such as responsive layout, theme switching and browser launch need visual/manual verification on the target OS.
