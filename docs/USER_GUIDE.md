# User Guide

[← Back to Capital Tracker](../README.md)

Capital Tracker is a monthly snapshot tracker: enter balances at the end of each month rather than logging every transaction. The interface is English only; this guide describes the current application behavior.

## Demo mode — a year of example finances

To explore the app with populated screens, start it with **`--demo`**:

```sh
go run ./cmd/capital-tracker --demo
```

If you have already built the executable, use `./CapitalTracker --demo` (or `CapitalTracker.exe --demo` on Windows). The browser opens at **http://127.0.0.1:8765**. If your normal instance is already using that port, choose another:

```sh
go run ./cmd/capital-tracker --demo --port 8766
```

**Demo mode never opens or changes your regular Capital Tracker database.** It uses a separate directory called `CapitalTrackerDemo` next to the regular `CapitalTracker` data directory. Normal `--data-dir` / `CAPITAL_TRACKER_DATA_DIR` overrides are deliberately ignored when `--demo` is selected. The sample is installed only if the demo database is completely empty, so edits made during a demo session remain in place when you restart it. To restore the original fixture, stop the demo and delete only the `CapitalTrackerDemo` folder, then launch with `--demo` again. Alternatively, use Settings → Danger zone → Delete all data while in demo mode, and restart.

The included fictional example represents a typical euro-paid working household, **not actual financial records or official statistical averages**. It contains **12 complete end-of-month snapshots, October 2025 through September 2026**, with six accounts arranged in three groups (Cash and savings, Investments, Liabilities): EUR everyday checking, emergency savings, long-term investments, USD brokerage holdings, EUR cash, and a negative EUR car-loan balance. The sample also has **12 months of named income, occasional major purchases and recurring expenses** (rent, groceries, utilities, mobile service and transport), with their own EUR histories and exact example exchange rates. These notes are **independent of the account balances**, not automatically booked transactions. Each capital month has its own example EUR/USD rate. Explore **Dashboard**, **Accounts**, **Monthly balances**, **Income**, **Major expenses** and **Recurring expenses** to inspect and edit the example.

The example is also provided as a fully importable, versioned JSON snapshot in [`internal/demo/sample-2025-2026.json`](../internal/demo/sample-2025-2026.json). You can import it via **Settings → JSON import and export** if desired, but **import replaces the currently open database**. For safe exploration, prefer `--demo`.

On **Dashboard**, **Accounts** and **Monthly balances**, click **Current month** beside the month picker to jump to the current month in your local time zone. Switching months prompts before discarding unsaved edits. Clicking it while already in the current month preserves your edits.

## Account groups

On **Accounts**, choose **New group** to create named sections such as Cash and savings, Investments and Loans. The group name is unique (case-insensitive). Each group has a header that can be expanded/collapsed, renamed, moved up/down with buttons or reordered by dragging the header. The collapsed/expanded state persists in this browser.

Accounts can be placed in a group as soon as they are created. Existing accounts can be dragged onto another account or group header, or assigned using the group selector next to each account (keyboard and touch alternative). Arrow buttons still reorder accounts inside their groups. An always-visible **Ungrouped** section receives unassigned accounts and accepts dropped accounts.

Each group header displays its **exact EUR subtotal** for the selected month (which can be switched at the top of Accounts). Group subtotals use the exchange rates saved for that particular month, include negative balances, and use the same exact rational arithmetic as the main net worth total. If any account active in that group lacks a balance or necessary rate for the selected month, its subtotal is **not displayed as zero**: the group is marked incomplete. Archived accounts stay visible but are not included in months when they are inactive. Individual group amounts are rounded once per group; due to rounding, the sum of rounded group subtotals can differ by one or more cents from the main once-rounded total.

Group membership is **organizational and current**, not a historical dimension: moving a previously recorded account changes which group's past-month subtotal includes its balances, but never changes the account history or the overall monthly net worth. Deleting a group only moves its accounts to **Ungrouped**; it does not delete accounts, balances or history. Old databases migrate automatically to schema version 2, retaining all accounts in Ungrouped until you organize them. A pre-migration SQLite backup is made automatically.

**Monthly balances** displays the same ordered groups and **Ungrouped**, with EUR subtotals for the selected month. There is no Archive section: accounts active in the selected month appear in their assigned groups, even if they were archived later. Accounts inactive in the selected month are omitted. Groups are collapsible, and the collapsed state is shared with Accounts. Both screens provide **Collapse all** and **Expand all** buttons for all groups displayed on that screen. Their state survives reload and application restart; using the buttons does not discard unsaved editor values. There is no group/account reordering, dragging, renaming or deletion on this screen: balance values and unsaved exchange rates are editable. Accounts are also offered before their first activity month so you can backfill history. Saving a balance there moves that account’s first activity month back; leaving it blank keeps its start unchanged. Accounts inside an archived gap have no editable balance row. Saved monthly exchange rates are fixed and remain unchanged when balances are edited.

## JSON import and export

Open **Settings → JSON import and export** in the browser:

- **Export JSON** downloads a readable, versioned snapshot of all saved accounts, group memberships and group order, their activity periods, monthly balances (including deliberately incomplete months), exchange rates, and appearance preferences and the legacy language field.
- **Import JSON** accepts a Capital Tracker JSON export (up to **8 MiB**) and **replaces all existing app data** after an in-app confirmation. Export the current data before importing; there is no merge and no undo.
- Import validates the format/schema version, currencies, dates, relationships and financial precision before starting a SQLite transaction. Malformed or inconsistent input is rejected; the existing data is preserved on failure. Import does not modify database migrations.
- This is a portable application-data snapshot, **not** a replacement for the SQLite `backup` command, which remains the preferred full-database backup. JSON exports contain personal financial information and should be stored securely.

JSON schema identifier for current exports: `{"format":"capital-tracker","schema_version":6}`. Older versions 1–5 can still be imported; version 1 accounts start in **Ungrouped**. Amounts such as `amount_minor` and fixed-point `rate_scaled` are decimal **strings**, never floating-point numbers. Period and timestamp records are retained. Exported data can be imported on another installation running a compatible schema version.

## Clearing all local data

Go to **Settings → Danger zone → Delete all data**. A dedicated in-app dialog explains the permanent loss and requires typing **DELETE** before the destructive button becomes available.

After confirmation, the app removes **all** accounts, groups, account activity periods, recorded months, balances, exchange rates and saved preferences, restoring English and dark appearance. Account IDs start from 1 again. SQLite tables and migrations stay in place, so you can begin again without reinstalling the application. All deletions are atomic: any database error rolls back the entire clear. This cannot be undone inside the app.

**Export a JSON backup before clearing.** Files previously exported as JSON or SQLite backups remain untouched; the command deletes application data in the active SQLite database, not external backup files. No background or automatic clearing occurs.

## Financial semantics

Balances are **end-of-month snapshots** in the account's native currency, stored as **integer minor units** (cents, including RSD). A blank entry means unknown and is *not* zero. FX rates are **end-of-month rates**, entered manually or loaded on request: `1 EUR = X USD / RSD / RUB / TRY` with up to eight decimals; the EUR rate is implicitly one. Monthly total = sum of each account's exact EUR-cent equivalent, rounded **once** to the nearest cent, ties away from zero for positive or negative amounts. Account figures in the table remain in their original currencies. Monthly changes compare only immediately consecutive **complete** months; percentage change is calculated from displayed rounded EUR-cent totals, and is undefined when the previous total is zero.

A month is complete only when it has at least one active account, each active account has a balance (zero is valid), and all currencies needed by active accounts have a rate. Empty months are incomplete and remain visible; missing months are not treated as zeros. There is no automatic carry-forward.

The Monthly balances editor permits **partial saves**: record one or more accounts now and add other balances or rates later. A partially saved month remains marked incomplete, and its EUR total is withheld until all required data exists. Each active account shows the balance from the **immediately preceding calendar month** in its native currency, along with a live difference against the current input. **Use previous** explicitly copies that value to the current input (including zero); it does not save until **Save month** is pressed. When there is no value for the immediately preceding month, the difference is unavailable and the copy button is disabled. Saving continues to replace the month atomically with all values currently present in the editor, so clearing an existing field and saving intentionally deletes that value. Balances are replaced atomically by a `PUT` for the selected month; omitting a balance removes it. Saved exchange rates are immutable: omitting a rate retains it, and changing a saved rate is rejected. New currencies can still receive their first saved rate. All timestamps are in UTC. Months accepted: `1900-01` through `2200-12` (including future months).

Accounts have a list of activity periods. Archiving requires an explicitly saved zero balance for the account in the latest saved month. A nonzero or missing balance blocks archiving, including accounts with no recorded balances. Save a zero balance in **Monthly balances** first. An archived account is removed from capital totals starting with its first excluded month; previous balances are kept. A restored account gets a **new period**, not a retroactive extension. To avoid silently changing historical completeness, creating accounts, archiving and restoring must not alter any already-created month. Use a start/archive/restore month *after* the latest existing month. If you accidentally record a future month, you can delete that month (and its balances and rates) using **Monthly Balances → Delete month**; deletion requires explicit confirmation and cannot be undone. Back up important data first.

Amounts in JSON are represented as **decimal strings of integer minor units**, not JavaScript numbers, to avoid loss of precision. Rates are transmitted as validated decimal strings; the server converts them to eight-place fixed-point integers. The UI accepts `.` or `,` as decimal separator and spaces as grouping separators; a comma is always a valid decimal separator, including three digits after the separator (`1,085`, `117,200`). Thousands must be grouped with spaces. All capital totals are calculated by Go, not JavaScript. Chart coordinates use approximate numeric geometry, while displayed amounts use exact decimal strings.

## Limitations

- Remote access requires the authenticated HTTPS setup in [Hosting](HOSTING.md). No server-independent offline editing or automatic FX updates.
- There are no automatic backups, transactions or cloud sync. JSON exports/imports are manual-only.
- Concurrent launching on the same data directory is prevented with a lock file; on macOS/Linux, an OS advisory lock releases automatically when the process exits, including after a crash; the lock file may safely remain. Windows uses the native LockFileEx advisory lock, which is also released by the OS after a crash; all platforms can leave the lock file on disk safely.
- Built-in browser checks such as responsive layout, theme switching and browser launch need visual/manual verification on the target OS.

The monthly editor loads the latest available rates into unsaved rate fields from [Exchange API](https://github.com/fawazahmed0/exchange-api) only when you click **Load latest exchange rates**. It never fetches rates automatically on startup, navigation or saving. The quote is current even when editing a past or future month; the displayed date identifies the quote and is independent of the selected month. Loading replaces unsaved entries, including manual values and previously loaded quotes; saved rates and edits made while the request is pending are preserved. Loaded rates are only stored when you save the month. Saving uses the exact values shown in the editor without fetching a newer quote. After saving, rate fields are read-only and quote loading is disabled when all rates are saved. Each month keeps its own saved rates: loading newer quotes for another month, restarting the app or opening history never replaces those historical values. The server contacts the provider and its fallback without sending account or balance data. Internet access is required for this optional feature; manual entry remains available. Rates are rounded to eight decimal places.

## Currency definitions and schema constraints

The canonical supported currency list is defined in `internal/finance/finance.go` and exposed to the browser by `/api/currencies`. The SQLite `CHECK` constraints intentionally repeat ISO codes as a defense against database corruption; adding a new currency requires a database migration and updating the canonical list. The MVP continues to support exactly EUR, USD, RSD, RUB and TRY.

## Income

Open **Income** and choose a month. In the **Add income** form at the top, enter a name (for example, Salary or Insurance refund), amount and currency, then click **Add income** or press Enter. The payment appears in the monthly income list below and the form resets for the next payment. Click **Save income** after adding entries and setting any required exchange rates to keep the month. Multiple payments can use the same currency. Set one exchange rate per currency in the separate **Exchange rates** block below the income list (**1 EUR = …**). It applies to every payment in that currency for the selected month. The block shows only currencies currently used in the list and is hidden for EUR-only income. Each entry shows its EUR equivalent and the total at the bottom updates as you type. Use the × button to remove a row. Rates can be entered manually or loaded with **Load latest exchange rates**, then saved with **Save income**. Amounts and currencies are fixed as soon as an income is added, including before saving. To correct either, remove the entry with × and add it again. Entries are displayed as plain text, like accounts. Shared exchange rates remain editable; to correct a name, remove the entry and add it again.

The chart shows monthly income totals converted to EUR. Missing months break the line. **Delete income** removes only the selected month's income notes after confirmation. Income notes do not change accounts, capital snapshots, or their exchange rates; deleting a capital month does not remove income notes. JSON export/import and full data deletion include income notes.

## Major expenses

Open **Major expenses** and choose a month. In the **Add expense** form at the top, enter a name (for example, Car, Holiday or Home renovation), amount and currency, then click **Add expense** or press Enter. The expense appears as a plain-text row below and the form resets for the next expense. To correct a name, amount or currency, remove the entry with × and add it again. Set one rate per currency in **Exchange rates**, or load rates automatically. Each row shows its EUR equivalent; the monthly total updates as you type. Click **Save expense** to save entries and rates. The chart shows saved monthly totals in EUR.

Use × to remove a row, or **Delete expense** to delete the selected month after confirmation. Expenses are independent of income and capital snapshots. JSON export/import and full data deletion include expense notes. Importing a backup from versions 1–4 clears current expense notes because those backups contain none.


## Recurring expenses

Open **Recurring expenses** and choose a month. Add named expenses, amounts and currencies, set one exchange rate per currency, and click **Save recurring expense**. Entries, rates, EUR equivalents and the history chart work like Major expenses.

An unsaved month starts with the list, amounts and rates from the most recent saved earlier month, even if calendar months were skipped. A message identifies the source month. Rates can be updated before saving. Opening a month does not create a saved record; save it to keep an independent monthly list. Changes to earlier months never replace an already saved later month.

Remove individual entries with ×, or clear the selected month with **Delete recurring expense**. Saving an empty list keeps that month empty and stops the old list from reappearing in following unsaved months. To correct an entry, remove it and add it again. Recurring expenses are separate from income, major expenses and capital balances. JSON export/import includes saved lists and empty months; importing versions 1–5 clears recurring expenses. **Delete all data** removes them too.
