# Browser integration coverage

The Playwright suite runs the compiled application in Chromium against a fresh temporary SQLite database for each scenario. It performs real clicks, typing, native pointer drags, downloads and uploads. Restart tests stop and restart the server process with the same database; they do not merely reload the browser.

## Scenario matrix

| Suite | Scenarios | What it verifies |
| --- | ---: | --- |
| `app.spec.cjs` | 31 | Account/group CRUD, confirmations, history protection, themes, monthly changes, rate loading and persistence, save/load races, import/export and a real external rate request |
| `groups-collapse.spec.cjs` | 16 | Individual groups and bulk collapse/expand on both screens; mixed/empty states; idempotency; shared state; reload/restart; renaming; preserving unsaved balances and rates |
| `groups-drag.spec.cjs` | 30 | Group ordering in both directions; ordering accounts before/after other accounts; populated, empty and collapsed destination groups; Ungrouped; Archive confirmation/cancellation; invalid virtual destinations; server error/retry; scrolling during a drag |
| `input-matrix.spec.cjs` | 52 | All five currencies, zero/debt, comma/grouped input, positive/negative amount boundaries, exact persistence after server restart, valid FX boundaries/eight-decimal precision and rejection of invalid values without overwriting history |
| `long-journeys.spec.cjs` | 5 | Multiple months across a year boundary, group/account reordering, collapse, server restart, export, full deletion, import, exact financial recovery; archive/inactive month/restore/history; bulk controls at 360, 390 and 768 pixels |
| `mobile-layout.spec.cjs` | 40 | 10 million in all five currencies at 320, 360, 390 and 430 pixels plus 844/932-pixel landscape; negative values and cents; Dashboard, Accounts, balances and history; numeric clipping, overlap and horizontal overflow; screenshots |
| **Total** | **174** | One external-provider scenario is opt-in; enable it for the full run below |

Each scenario can contain many assertions. Counts describe concrete paths through the application, not all possible combinations of user input and external failures.

## Run every scenario, including the real currency provider

```sh
CAPITAL_TRACKER_LIVE_RATES=1 npm run test:ui -- --workers=4
```

The live scenario does not intercept the exchange-rate response. It clicks the button in the browser, lets the Go server contact the public provider, then checks the exact loaded values in the form, saved month and history after reload. It requires internet access and can fail if the external provider is unavailable. Ordinary CI skips this one scenario and uses deterministic rate responses for the remaining cases.

```sh
npm run check
npm run test:ui -- --workers=4
```

Mobile layout scenarios save screenshots in `test-results/` for visual review and assert that monetary values remain readable on one line, balance inputs fit their values, group captions do not overlap totals, and tables scroll inside their own containers. Failures retain Playwright traces in `test-results/`. Replay a trace with `npx playwright show-trace <trace.zip>`.

## Financial invariants

- Saving a month uses the values already displayed in the editor; it does not fetch a newer quote.
- Each month retains its own exchange-rate snapshot. New quotes, organizational changes, restart and export/import cannot silently revalue existing history.
- Invalid inputs and rejected operations preserve previously saved data.
- Missing values remain distinct from zero; incomplete months do not produce a reliable total or month-to-month change.
- Group movement and visibility change presentation and organization without changing balances or overall monthly capital.

The Go finance, storage and HTTP tests additionally verify exact arithmetic, overflow, rounding, validation, rollback, security and independent snapshot persistence. Browser coverage complements these checks.
