# Capital Tracker — Screenshot Gallery

[← Back to the project](../../README.md)

All ten screenshots are **real Chromium captures of Capital Tracker in Dark mode**, using the isolated, fictional 12-month demo. They are not generated mockups and contain no private financial records. The same demo includes populated balances, income, major expenses and recurring expenses. The dashboard now includes a month-review checklist, and the interface uses the current family-finance layout.

**Click or tap an image to open the original full-resolution PNG.** The two mobile captures use a 390-pixel browser viewport.

## 1. Dashboard

<a href="https://raw.githubusercontent.com/perevozchiko/capital-tracker/master/docs/screenshots/dashboard.png">
  <img src="dashboard.png" alt="EUR capital total, previous-month comparison and history chart.">
</a>

EUR capital total, previous-month comparison and history chart. [Full-size PNG](https://raw.githubusercontent.com/perevozchiko/capital-tracker/master/docs/screenshots/dashboard.png).

## 2. Monthly balances

<a href="https://raw.githubusercontent.com/perevozchiko/capital-tracker/master/docs/screenshots/monthly-balances.png">
  <img src="monthly-balances.png" alt="Grouped account balances, previous-month differences and exchange-rate editor.">
</a>

Grouped account balances, previous-month differences and exchange-rate editor. [Full-size PNG](https://raw.githubusercontent.com/perevozchiko/capital-tracker/master/docs/screenshots/monthly-balances.png).

## 3. Accounts and groups

<a href="https://raw.githubusercontent.com/perevozchiko/capital-tracker/master/docs/screenshots/accounts.png">
  <img src="accounts.png" alt="Collapsible account groups, current EUR subtotals and account management.">
</a>

Collapsible account groups, current EUR subtotals and account management. [Full-size PNG](https://raw.githubusercontent.com/perevozchiko/capital-tracker/master/docs/screenshots/accounts.png).

## 4. Income

<a href="https://raw.githubusercontent.com/perevozchiko/capital-tracker/master/docs/screenshots/income.png">
  <img src="income.png" alt="Named salary and other income entries, their currencies, EUR total and monthly history.">
</a>

Named salary and other income entries, their currencies, EUR total and monthly history. [Full-size PNG](https://raw.githubusercontent.com/perevozchiko/capital-tracker/master/docs/screenshots/income.png).

## 5. Major expenses

<a href="https://raw.githubusercontent.com/perevozchiko/capital-tracker/master/docs/screenshots/major-expenses.png">
  <img src="major-expenses.png" alt="Named occasional purchases, EUR totals and large-expense history.">
</a>

Named occasional purchases, EUR totals and large-expense history. [Full-size PNG](https://raw.githubusercontent.com/perevozchiko/capital-tracker/master/docs/screenshots/major-expenses.png).

## 6. Recurring expenses

<a href="https://raw.githubusercontent.com/perevozchiko/capital-tracker/master/docs/screenshots/recurring-expenses.png">
  <img src="recurring-expenses.png" alt="Monthly recurring costs with grouped rows, EUR subtotals and their own history. Unsaved months inherit the previous saved snapshot.">
</a>

Regular monthly costs and their independent month-end history; unsaved months inherit the previous saved snapshot. [Full-size PNG](https://raw.githubusercontent.com/perevozchiko/capital-tracker/master/docs/screenshots/recurring-expenses.png).

## 7. Saved exchange-rate history

<a href="https://raw.githubusercontent.com/perevozchiko/capital-tracker/master/docs/screenshots/fx-history.png">
  <img src="fx-history.png" alt="Saved currency conversion rates by month, with a history chart and time filter.">
</a>

Saved conversion rates are displayed for the recorded months rather than recomputed from current market quotes. [Full-size PNG](https://raw.githubusercontent.com/perevozchiko/capital-tracker/master/docs/screenshots/fx-history.png).

## 8. Settings and exports

<a href="https://raw.githubusercontent.com/perevozchiko/capital-tracker/master/docs/screenshots/settings.png">
  <img src="settings.png" alt="Settings with CSV and Excel export, JSON import and export, backups and themes.">
</a>

CSV and Excel (.xlsx) reports, portable JSON backup/import, local SQLite backups and appearance settings. [Full-size PNG](https://raw.githubusercontent.com/perevozchiko/capital-tracker/master/docs/screenshots/settings.png).

## 9. Mobile dashboard

<a href="https://raw.githubusercontent.com/perevozchiko/capital-tracker/master/docs/screenshots/mobile-dashboard.png">
  <img src="mobile-dashboard.png" alt="The real dashboard in a 390-pixel phone viewport." width="390">
</a>

The real dashboard in a 390-pixel phone viewport. [Full-size PNG](https://raw.githubusercontent.com/perevozchiko/capital-tracker/master/docs/screenshots/mobile-dashboard.png).

## 10. Mobile balances

<a href="https://raw.githubusercontent.com/perevozchiko/capital-tracker/master/docs/screenshots/mobile-balances.png">
  <img src="mobile-balances.png" alt="Grouped balance editor in a 390-pixel phone viewport." width="390">
</a>

Grouped balance editor in a 390-pixel phone viewport. [Full-size PNG](https://raw.githubusercontent.com/perevozchiko/capital-tracker/master/docs/screenshots/mobile-balances.png).

## Regenerate from the actual app

Run from the repository root, using Python Playwright and Chromium:

```sh
python3 -m pip install playwright
python3 -m playwright install chromium
python3 scripts/capture-demo-screenshots.py
```

The script captures all ten views from a newly built Go app with `--demo`, uses a **fresh temporary data directory**, chooses Dark in the app's Settings UI and captures desktop and mobile pages from Chromium. It never opens your regular database. The demo fixture in `internal/demo/sample-2025-2026.json` is also available to normal `--demo` users.

Alternatively, run **Actions → Capture demo screenshots → Run workflow** on `master`. The workflow commits refreshed PNGs only when the actual captures change. A dedicated `docs/refresh-screenshots-*` branch can also trigger the same capture automatically; changes are committed back to that branch for review before merge.

**GitHub limitation:** repository Markdown does not run a custom zoom/lightbox viewer. Images link to the original file, where your browser's image viewer can zoom in.
