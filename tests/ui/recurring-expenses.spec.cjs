const { test, expect, open, nav, setMonth } = require('./helpers.cjs');

for (const width of [320, 1280]) {
  test(`recurring expenses inherit and save independent months at ${width}px`, async ({
    page,
    app,
    restartApp,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, app);
    await nav(page, 'Recurring expenses');
    await setMonth(page, '2026-10');
    const rows = page.locator('[data-recurring-expense-row]');
    await expect(rows).toHaveCount(0);
    await page.locator('#recurringExpenseName').fill('Rent');
    await page.locator('#recurringExpenseAmount').fill('800');
    await page.locator('#addRecurringExpenseForm button').click();
    await page.locator('#recurringExpenseName').fill('Internet');
    await page.locator('#recurringExpenseAmount').fill('110');
    await page.locator('#recurringExpenseCurrency').selectOption('USD');
    await page.locator('#addRecurringExpenseForm button').click();
    await page.locator('[data-recurring-expense-rate="USD"]').fill('1.1');
    await expect(page.locator('#recurringExpenseTotal')).toHaveText('€900.00');
    const save = async () => {
      const oldForm = await page
        .locator('#recurringExpenseForm')
        .elementHandle();
      await page.locator('#recurringExpenseForm [type="submit"]').click();
      await expect
        .poll(() => oldForm.evaluate((el) => el.isConnected))
        .toBe(false);
      await expect(page.locator('#toast')).toHaveText(
        'Recurring expense saved.',
      );
    };
    await save();
    await setMonth(page, '2026-11');
    await expect(rows).toHaveCount(2);
    await expect(
      page.getByText('Copied from 2026-10.', { exact: false }),
    ).toBeVisible();
    await rows
      .last()
      .getByRole('button', { name: 'Remove recurring expense' })
      .click();
    await save();
    await setMonth(page, '2026-10');
    await expect(rows).toHaveCount(2);
    await setMonth(page, '2026-12');
    await expect(rows).toHaveCount(1);
    await expect(page.locator('#recurringExpenseTotal')).toHaveText('€800.00');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath('recurring-expenses.png'),
      fullPage: true,
    });
    await page.locator('[data-action="deleteRecurringExpense"]').click();
    await page.locator('#confirmAccept').click();
    await expect(rows).toHaveCount(0);
    await restartApp();
    await page.reload();
    await nav(page, 'Recurring expenses');
    await setMonth(page, '2027-01');
    await expect(rows).toHaveCount(0);
    await setMonth(page, '2026-11');
    await expect(rows).toHaveCount(1);
    await page
      .locator('[data-chart-source="recurringExpense"]')
      .first()
      .focus();
    await expect(page.locator('#chartTooltip')).toContainText('€900.00');
    await page.locator('#amountVisibility').click();
    await expect(rows.locator('.money-text').first()).toBeHidden();
    await nav(page, 'Major expenses');
    await expect(page.locator('[data-expense-row]')).toHaveCount(0);
  });
}

const recurringRows = (page) => page.locator('[data-recurring-expense-row]');
const recurringRate = (page, currency) =>
  page.locator(`[data-recurring-expense-rate="${currency}"]`);

async function addRecurring(page, name, amount, currency = 'EUR') {
  await page.locator('#recurringExpenseName').fill(name);
  await page.locator('#recurringExpenseAmount').fill(amount);
  await page.locator('#recurringExpenseCurrency').selectOption(currency);
  await page.locator('#addRecurringExpenseForm button').click();
}

async function saveRecurring(page) {
  const oldForm = await page.locator('#recurringExpenseForm').elementHandle();
  await page.locator('#recurringExpenseForm [type="submit"]').click();
  await expect.poll(() => oldForm.evaluate((el) => el.isConnected)).toBe(false);
  await expect(page.locator('#toast')).toHaveText('Recurring expense saved.');
}

async function recurringMonth(page, month) {
  if ((await page.locator('.month-picker').inputValue()) === month) return;
  const loaded = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/recurring-expenses/' + month) &&
      response.request().method() === 'GET',
  );
  await setMonth(page, month);
  expect((await loaded).ok()).toBe(true);
  await expect(page.locator('#recurringExpenseForm')).toBeVisible();
}

test('recurring expenses validate input and preserve edits when navigation is cancelled', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Recurring expenses');
  await recurringMonth(page, '2026-10');
  await addRecurring(page, '   ', '100');
  await expect(page.locator('#toast')).toHaveText('Please enter a name.');
  await expect(recurringRows(page)).toHaveCount(0);
  await addRecurring(page, 'Internet', '-1');
  await expect(page.locator('#toast')).toHaveText(
    'Recurring expense must be zero or positive.',
  );
  await expect(recurringRows(page)).toHaveCount(0);
  await addRecurring(page, 'Internet', '110', 'USD');
  await page.locator('#recurringExpenseForm [type="submit"]').click();
  await expect(page.locator('#toast')).toContainText('positive exchange rate');
  await expect(recurringRows(page)).toHaveCount(1);
  await nav(page, 'Dashboard');
  await page.locator('#confirmCancel').click();
  await expect(page.locator('#recurringExpenseForm')).toBeVisible();
  await expect(recurringRows(page)).toHaveCount(1);
  await page.locator('[data-action="monthNext"]').click();
  await page.locator('#confirmCancel').click();
  await expect(page.locator('.month-picker')).toHaveValue('2026-10');
  await recurringRate(page, 'USD').fill('1.1');
  await saveRecurring(page);
  await addRecurring(page, 'Unsaved', '50');
  await page.locator('[data-action="monthNext"]').click();
  await page.locator('#confirmAccept').click();
  await expect(page.locator('.month-picker')).toHaveValue('2026-11');
  await expect(recurringRows(page)).toHaveCount(1);
  await expect(
    recurringRows(page).locator('[data-recurring-expense-name]'),
  ).toHaveText('Internet');
});

test('inherited shared rates apply to all matching entries and remain independent after saving', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Recurring expenses');
  await recurringMonth(page, '2026-10');
  await addRecurring(page, 'Internet', '100', 'USD');
  await addRecurring(page, 'Phone', '20', 'USD');
  await addRecurring(page, 'Rent', '800');
  await recurringRate(page, 'USD').fill('2');
  await saveRecurring(page);
  await recurringMonth(page, '2027-01');
  await expect(recurringRate(page, 'USD')).toHaveValue('2');
  await expect(page.locator('[data-recurring-expense-rate]')).toHaveCount(1);
  await expect(page.locator('#recurringExpenseTotal')).toHaveText('€860.00');
  await recurringRate(page, 'USD').fill('1');
  await expect(
    recurringRows(page).nth(0).locator('[data-recurring-expense-eur]'),
  ).toHaveText('€100.00');
  await expect(
    recurringRows(page).nth(1).locator('[data-recurring-expense-eur]'),
  ).toHaveText('€20.00');
  await saveRecurring(page);
  await recurringMonth(page, '2026-10');
  await expect(recurringRate(page, 'USD')).toHaveValue('2');
  await expect(page.locator('#recurringExpenseTotal')).toHaveText('€860.00');
  await recurringMonth(page, '2027-02');
  await expect(recurringRate(page, 'USD')).toHaveValue('1');
  await expect(page.locator('#recurringExpenseTotal')).toHaveText('€920.00');
  await page.locator('[data-action="deleteRecurringExpense"]').click();
  await page.locator('#confirmCancel').click();
  await expect(recurringRows(page)).toHaveCount(3);
  const history = await (
    await page.request.get(app + '/api/recurring-expenses')
  ).json();
  expect(history.map((month) => month.month)).toEqual(['2026-10', '2027-01']);
});

test('recurring rate loading preserves concurrent edits and a failed save can be retried', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Recurring expenses');
  await recurringMonth(page, '2026-10');
  await addRecurring(page, 'Internet', '110', 'USD');
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/exchange-rates?*', async (route) => {
    await gate;
    await route.fulfill({
      json: { date: '2026-10-30', rates: { USD: '1.1' } },
    });
  });
  await page.locator('[data-action="loadRecurringExpenseRates"]').click();
  const saveButton = page.locator('#recurringExpenseForm [type="submit"]');
  await expect(saveButton).toBeDisabled();
  await recurringRate(page, 'USD').fill('2.2');
  release();
  await expect(saveButton).toBeEnabled();
  await expect(recurringRate(page, 'USD')).toHaveValue('2.2');
  await expect(page.locator('#recurringExpenseTotal')).toHaveText('€50.00');
  await page.route('**/api/recurring-expenses/2026-10', (route) => {
    if (route.request().method() === 'PUT')
      return route.fulfill({
        status: 500,
        json: { error: { code: 'internal_error' } },
      });
    return route.continue();
  });
  await saveButton.click();
  await expect(page.locator('#toast')).toHaveText('Database or server error.');
  await expect(saveButton).toBeEnabled();
  await expect(recurringRows(page)).toHaveCount(1);
  expect(
    await (await page.request.get(app + '/api/recurring-expenses')).json(),
  ).toEqual([]);
  await page.unroute('**/api/recurring-expenses/2026-10');
  await saveRecurring(page);
  await page.reload();
  await nav(page, 'Recurring expenses');
  await recurringMonth(page, '2026-10');
  await expect(recurringRate(page, 'USD')).toHaveValue('2.2');
  await expect(page.locator('#recurringExpenseTotal')).toHaveText('€50.00');
});

test('JSON export, clear and import restore recurring entries and empty months', async ({
  page,
  app,
}, testInfo) => {
  await open(page, app);
  await nav(page, 'Recurring expenses');
  await recurringMonth(page, '2026-10');
  await addRecurring(page, 'Internet', '110', 'USD');
  await recurringRate(page, 'USD').fill('1.1');
  await saveRecurring(page);
  await recurringMonth(page, '2026-11');
  await expect(recurringRows(page)).toHaveCount(1);
  await recurringRows(page)
    .getByRole('button', { name: 'Remove recurring expense' })
    .click();
  await saveRecurring(page);
  await nav(page, 'Settings');
  const pendingDownload = page.waitForEvent('download');
  await page.locator('[data-action="exportJSON"]').click();
  const download = await pendingDownload;
  const file = testInfo.outputPath('recurring-backup.json');
  await download.saveAs(file);
  await page.locator('[data-action="clearAllData"]').click();
  await page.locator('#clearDataPhrase').fill('DELETE');
  await page.locator('#clearDataAccept').click();
  await expect(page.getByText('Welcome to Capital Tracker')).toBeVisible();
  await nav(page, 'Recurring expenses');
  await recurringMonth(page, '2026-10');
  await expect(recurringRows(page)).toHaveCount(0);
  await nav(page, 'Settings');
  await page.locator('#jsonFileInput').setInputFiles(file);
  await page.locator('#confirmAccept').click();
  await expect(page.locator('#toast')).toContainText(
    'JSON data imported successfully',
  );
  await nav(page, 'Recurring expenses');
  await recurringMonth(page, '2026-10');
  await expect(recurringRows(page)).toHaveCount(1);
  await expect(recurringRate(page, 'USD')).toHaveValue('1.1');
  await expect(page.locator('#recurringExpenseTotal')).toHaveText('€100.00');
  await recurringMonth(page, '2026-12');
  await expect(recurringRows(page)).toHaveCount(0);
  await expect(
    page.getByText('Copied from 2026-11.', { exact: false }),
  ).toBeVisible();
});
