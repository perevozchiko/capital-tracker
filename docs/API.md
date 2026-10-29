# HTTP API

[← Back to Capital Tracker](../README.md) · [Architecture](ARCHITECTURE.md)

The API is designed for the locally running application (loopback HTTP), not for remote clients. It uses JSON. Never expose its port on a public network.

## Endpoint reference

All endpoints use JSON (`Content-Type: application/json` on writes) and errors have the shape `{"error":{"code":"validation_error","field":"month"}}` (conflicts also include a stable localized `reason` identifier). Requests that change data must supply `X-Capital-Tracker: 1`; the server enforces strict `Host` and `Origin` checks and does not enable cross-origin access. Endpoints:

| Method | Endpoint | Function |
| --- | --- | --- |
| `GET`, `POST` | `/api/accounts` | List / create accounts (`name`, `currency`, `start_month`, optional `group_id`) |
| `PATCH`, `DELETE` | `/api/accounts/{id}` | Change account name or currency (currency only before any recorded balance) / delete history-free account |
| `POST` | `/api/accounts/{id}/archive` | `{"month":"2026-11"}` |
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
