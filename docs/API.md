# HTTP API

[← Back to Capital Tracker](../README.md) · [Architecture](ARCHITECTURE.md)

The API is designed for the locally running application (loopback HTTP), not for remote clients. It uses JSON. Never expose its port on a public network.

## Endpoint reference

All endpoints use JSON (`Content-Type: application/json` on writes) and errors have the shape `{"error":{"code":"validation_error","field":"month"}}` (conflicts also include a stable localized `reason` identifier). Requests that change data must supply `X-Capital-Tracker: 1`; the server enforces strict `Host` and `Origin` checks and does not enable cross-origin access. Endpoints:

| Method | Endpoint | Function |
| --- | --- | --- |
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
| `GET` | `/api/meta` | App identity, version, and build commit |
| `GET` | `/api/exchange-rates?month=YYYY-MM` | Fetch the latest available EUR rates on demand; optional month identifies the editor and does not select a historical date; does not save them |
| `GET` | `/api/currencies` | Supported ISO 4217 currency codes from Go |
| `GET` | `/api/data/export` | Download complete application JSON snapshot |
| `POST` | `/api/data/import` | Atomically replace data with valid exported JSON (requires `X-Capital-Tracker-Import: replace` and the regular CSRF header) |
| `POST` | `/api/data/clear` | Erase all local app data and reset settings (requires the regular CSRF header, `X-Capital-Tracker-Clear: DELETE`, and JSON `{"confirm":"DELETE"}`) |

Example full monthly replacement:

```json
{
  "balances": [ { "account_id": 1, "amount_minor": "11720000" } ],
  "rates": [ { "currency": "RSD", "rate": "117.20" } ]
}
```

`PUT /api/months/{month}` creates the month when needed, and removes old balance/rate entries omitted from this request. `POST /api/months` creates a deliberately empty month and rejects duplicates. `DELETE /api/months/{month}` requires JSON `{"confirm":true}` with the CSRF header and permanently removes the month plus its balances and rates via one SQLite transaction; other months remain unchanged. Never call `PUT` with an empty payload unintentionally, as that means clear the month. Requests are limited to 1 MiB.

For `GET /api/groups`, optional `view=monthly` keeps accounts active in the selected month in their assigned groups, including accounts archived later, instead of placing them in Archive. The default view retains the Accounts screen grouping.

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

Amounts must be nonnegative integer minor-unit strings; each entry requires a trimmed nonempty `name` of at most 100 characters. Multiple entries may share the same currency or name; their order is preserved. Rates mean **1 EUR = rate units of currency**, must be positive, and use at most eight decimals. EUR requires rate `1`. The total sums exact conversions and rounds once. An empty `entries` array deletes the income month; a zero amount records it. Writes require the regular CSRF header and return HTTP 204. Income notes have independent rates and never create or alter capital months or accounts.

JSON exports use `schema_version: 5` and include `incomes` and `expenses` arrays with the same entry fields. Versions 1–4 remain importable. Version 3 income totals are converted to entries named `Income · {currency}`; versions 1 and 2 contain no income notes. Import replaces all data, including income and expense notes. Versions 1–4 have no expense notes.

## Major expenses

`GET /api/expenses` and `PUT /api/expenses/{month}` use the same response shape, entry fields, validation, conversion rules and CSRF requirements as income notes. Each expense has a name, amount, currency and rate. An empty `entries` array deletes that month’s expenses. Expenses have independent monthly rates and do not alter income notes, accounts or capital snapshots. Exports include an `expenses` array; imports and full data deletion include expense notes.
