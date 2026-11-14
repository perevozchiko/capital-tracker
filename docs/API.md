# HTTP API

[← Back to Capital Tracker](../README.md) · [Architecture](ARCHITECTURE.md)

The API is designed for the locally running application (loopback HTTP), not for remote clients. It uses JSON. Never expose its port on a public network.

## Endpoint reference

All endpoints use JSON (`Content-Type: application/json` on writes) and errors have the shape `{"error":{"code":"validation_error","field":"month"}}` (conflicts also include a stable localized `reason` identifier). Requests that change data must supply `X-Capital-Tracker: 1`; the server enforces strict `Host` and `Origin` checks and does not enable cross-origin access. Endpoints:

| Method | Endpoint | Function |
| --- | --- | --- |
| `GET` | `/api/auth/status` | Return `enabled` and `authenticated`; does not accept device trust as a session |
| `POST` | `/api/auth/login` | Configured auth only: username/password, optional `remember`, `code`, `trust_device`; returns 204 and cookies on success |
| `POST` | `/api/auth/logout` | Configured auth only: revoke this session and clear its cookie; preserve device trust |
| `GET`, `POST` | `/api/accounts` | List / create accounts (`name`, `currency`, `start_month`, optional `group_id`) |
| `PATCH`, `DELETE` | `/api/accounts/{id}` | Change account name or currency (currency only before any recorded balance) / delete history-free account |
| `POST` | `/api/accounts/{id}/archive` | `{"month":"2026-11"}`; requires an explicit zero balance in the latest saved month, otherwise returns `409` with reason `archive_requires_zero_balance` |
| `POST` | `/api/accounts/{id}/restore` | `{"start_month":"2026-12"}` |
| `PUT` | `/api/accounts/reorder` | `{"ids":[1,2,3]}` full atomic order (legacy) |
| `PUT` | `/api/accounts/assignments` | Full atomic list `{"accounts":[{"id":1,"group_id":2},{"id":3,"group_id":null}]}`; includes **every** account in display order |
| `GET`, `POST` | `/api/groups` | List groups with exact EUR subtotals for optional `?month=YYYY-MM`, or create a group with `{"name":"Cash"}` |
| `PATCH`, `DELETE` | `/api/groups/{id}` | Rename group or delete container (accounts become ungrouped) |
| `PUT` | `/api/groups/reorder` | `{"ids":[1,2,3]}` exact full group order |
| `GET`, `POST` | `/api/months` | List / explicitly create empty month |
| `GET`, `PUT`, `DELETE` | `/api/months/{YYYY-MM}` | Read / replace / delete a month (DELETE requires `{"confirm":true}`) |
| `GET` | `/api/dashboard?month=YYYY-MM&columns=12` | Summary, previous month and 1–120 monthly columns |
| `GET` | `/api/capital/history` | Chronological complete/incomplete points |
| `GET`, `PATCH` | `/api/settings` | Read / update appearance (legacy language field retained) |
| `GET` | `/api/meta` | App identity, version, and build commit; `label` only when `CAPITAL_TRACKER_INSTANCE_LABEL` is set |
| `GET` | `/api/exchange-rates?month=YYYY-MM` | Fetch the latest available EUR rates on demand; optional month identifies the editor and does not select a historical date; does not save them |
| `GET` | `/api/currencies` | Supported ISO 4217 currency codes from Go |
| `GET` | `/api/data/export` | Download complete application JSON snapshot |
| `POST` | `/api/data/import` | Atomically replace data with valid exported JSON (requires `X-Capital-Tracker-Import: replace` and the regular CSRF header) |
| `POST` | `/api/data/clear` | Erase all local app data and reset settings (requires the regular CSRF header, `X-Capital-Tracker-Clear: DELETE`, and JSON `{"confirm":"DELETE"}`) |
| `GET` | `/api/backups` | List managed SQLite copies newest first: `backups` (`id`, `created_at`, `kind`, `size` in bytes), `limit: 50`, `next_at` (UTC or null), optional `last_error` |
| `POST` | `/api/backups` | Create a manual copy, then retain the newest 50 managed copies; returns HTTP 201 with copy metadata |
| `POST` | `/api/backups/{id}/restore` | Save a recovery copy and atomically replace application data; requires `X-Capital-Tracker-Restore: replace` plus the regular CSRF header; returns `ok` and `safety_backup` metadata |

For archive reads, send **`X-Capital-Tracker-Snapshot: {id}`** with data `GET` requests, including JSON export. The server reads an isolated read-only copy, with authentication applied before archive access. Selection is per request; live reads without this header remain unaffected. Requests that change data with this header return HTTP 403 `backup_read_only`; quote loading and updater routes are also unavailable in preview. `/api/backups`, `/api/meta` and auth status remain live. A missing/pruned copy returns HTTP 404 `backup_not_found`, never live financial data as a fallback. Archive responses use `Cache-Control: no-store`.

Backup IDs must be server-issued filenames, not filesystem paths. Weekly timing and retention metadata live outside application tables, so restoring data does not reset the automatic schedule. Restore returns an error without replacing data if its recovery copy cannot be saved, and replacement errors roll back the transaction. All managed copy types share the 50-copy limit.

Example full monthly replacement:

```json
{
  "balances": [ { "account_id": 1, "amount_minor": "11720000" } ],
  "rates": [ { "currency": "RSD", "rate": "117.20" } ]
}
```

`PUT /api/months/{month}` creates the month when needed, and removes old balance/rate entries omitted from this request. `POST /api/months` creates a deliberately empty month and rejects duplicates. `DELETE /api/months/{month}` requires JSON `{"confirm":true}` with the CSRF header and permanently removes the month plus its balances and rates via one SQLite transaction; other months remain unchanged. Never call `PUT` with an empty payload unintentionally, as that means clear the month. Requests are limited to 1 MiB.

For `GET /api/groups`, optional `view=monthly` keeps accounts active in the selected month in their assigned groups, including accounts archived later, instead of placing them in Archive. The default view retains the Accounts screen grouping.

## Authentication and device trust

When server authentication is configured, protected endpoints require the `capital_tracker_session` cookie. Login accepts:

```json
{
  "username": "andrei",
  "password": "your password",
  "remember": true,
  "code": "012345",
  "trust_device": true
}
```

`code` is a string to preserve leading zeros. With TOTP enabled, correct credentials without a valid trusted-device cookie return HTTP 401 `two_factor_required` if the code is missing, or `invalid_two_factor_code` if it is invalid, expired, or already used. No session or device cookie is issued on either response. Resubmit the same credentials with the current six-digit code. The password is checked on every attempt; invalid credentials always return `invalid_credentials`. Throttled attempts return HTTP 429 `login_rate_limited` with `Retry-After`.

`remember` controls session lifetime only. `trust_device` separately persists a confirmed browser for 180 days and defaults to false for API clients. A successful login with trust enabled issues/rotates `capital_tracker_trusted_device`; subsequent logins with that cookie still require the password but can omit `code`. Trust is renewed on successful password sign-in and survives sign-out. A successful login with `trust_device: false` removes any existing trust for that browser. The trust cookie alone cannot read protected endpoints. See [Hosting](HOSTING.md#two-factor-confirmation-for-new-devices) for enrollment, expiry, reset and recovery.

## Income notes

`GET /api/incomes` returns months in ascending order, each with `month`, `entries`, `total_eur_minor` (decimal string), and `complete: true`. `PUT /api/incomes/{month}` atomically replaces only that month's income notes:

```json
{
  "entries": [
    { "month": "2026-01", "name": "Salary", "currency": "USD", "amount_minor": "110000", "rate": "1.1" },
    { "month": "2026-01", "name": "Insurance refund", "currency": "EUR", "amount_minor": "50000", "rate": "1" }
  ]
}
```

Amounts must be nonnegative integer minor-unit strings; each entry requires a trimmed nonempty `name` of at most 100 characters. Multiple entries may share the same currency or name; their order is preserved. Rates mean **1 EUR = rate units of currency**, must be positive, and use at most eight decimals. EUR requires rate `1`. The total sums exact conversions and rounds once. An empty `entries` array records an explicitly reviewed zero-income month. `DELETE /api/incomes/{month}` removes both its entries and review marker. Writes require the regular CSRF header and return HTTP 204. Income notes have independent rates and never create or alter capital months or accounts.

JSON exports use `schema_version: 9` and include `incomes`, `expenses`, `expense_groups` (per month: `month` and `groups`), monthly `recurring_expenses` snapshots and `monthly_reviews` markers (`section` and `month`). Versions 1–8 remain importable; entry-bearing income and expense months in older backups become reviewed months. Version 3 income totals are converted to entries named `Income · {currency}`; versions 1 and 2 contain no income notes. Import replaces all data, including income and expense notes. Versions 1–4 have no expense notes, versions 1–5 have no recurring snapshots, versions 1–6 have no recurring groups, and versions 1–8 have no major-expense groups.

## Major expenses

`GET /api/expenses` and `PUT /api/expenses/{month}` use the same response shape, entry fields, validation, conversion rules and CSRF requirements as income notes. Each expense has a name, amount, currency and rate. An empty `entries` array records an explicitly reviewed zero-expense month. `DELETE /api/expenses/{month}` removes both its entries and review marker. Expenses have independent monthly rates and do not alter income notes, accounts or capital snapshots. Exports include an `expenses` array; imports and full data deletion include expense notes.

Major expenses can be grouped like recurring expenses. Each month in `GET /api/expenses` includes ordered `groups` (`name`, `entry_positions`, `total_eur_minor`) and `ungrouped_total_eur_minor`. `PUT /api/expenses/{month}` accepts an optional `groups` array with the same shape and validation rules as recurring-expense groups; entries and groups are replaced together in one transaction, and omitting `groups` saves every entry as Ungrouped. Groups belong to their month only: major expenses are never inherited, so another month starts without groups. Groups never change the monthly total. `DELETE /api/expenses/{month}` also removes that month's groups. Schema migration 9 adds the group tables without changing existing expenses.

See [host-managed release updates](UPDATES.md) for the optional Settings → About update button, macOS/OrbStack agent, IPC security and installation contract. Updates require an explicit button click.

## Recurring expenses and groups

`GET /api/recurring-expenses` returns saved monthly totals for the history chart. `GET /api/recurring-expenses/{month}` returns the selected snapshot, or inherits the latest earlier snapshot without creating records. The response includes `inherited_from` when inherited, ordered `groups` with `name`, `entry_positions` and `total_eur_minor`, plus `ungrouped_total_eur_minor`. A position is a zero-based index into that snapshot's `entries` array; unassigned entries belong to Ungrouped. Each subtotal converts exactly and rounds once, independently of the overall monthly total.

`PUT /api/recurring-expenses/{month}` saves entries, groups and their order atomically for that month:

```json
{
  "entries": [
    {"month": "2026-01", "name": "Rent", "currency": "EUR", "amount_minor": "80000", "rate": "1"},
    {"month": "2026-01", "name": "Internet", "currency": "USD", "amount_minor": "11000", "rate": "1.1"}
  ],
  "groups": [
    {"name": "Home", "entry_positions": [0, 1]},
    {"name": "Subscriptions", "entry_positions": []}
  ]
}
```

Group names must be distinct ignoring case, trimmed, nonempty and at most 100 characters. Each entry can appear in at most one group; positions must reference existing entries. Empty groups are retained. Omitting `groups` saves all entries as Ungrouped. Saving an empty `entries` array preserves an empty monthly snapshot, stopping inheritance of older expenses. Existing saved months stay unchanged; later unsaved months inherit the new snapshot. CSRF requirements and entry validation match major expenses. JSON exports, backups, imports and full deletion include group membership and order. Schema migration 7 adds the group tables without changing older snapshots; opening an older database first creates a migration backup.

## Saved exchange-rate history

`GET /api/exchange-rates/history` returns saved non-EUR quotes with `month`, `currency`, exact decimal `rate` and `source` (`monthly`, `incomes`, `expenses` or `recurringExpenses`). Independent quotes from different sections are preserved. The FX Rates page shows the saved quotes and their history without fetching newer rates or changing existing data. Backup preview reads quotes from the selected archive.
