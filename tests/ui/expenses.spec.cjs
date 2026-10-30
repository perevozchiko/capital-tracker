const { test, expect, open, nav, setMonth } = require('./helpers.cjs');
const rows = (page) => page.locator('[data-expense-row]');
async function add(page, name, amount, currency = 'EUR', rate = '') {
  await page.getByRole('button', { name: 'Add expense', exact: true }).click();
  const row = rows(page).last();
  await row.locator('[data-expense-name]').fill(name);
  await row.locator('[data-expense]').fill(amount);
  await row.locator('[data-expense-currency]').selectOption(currency);
  if (rate) await page.locator(`[data-expense-rate="${currency}"]`).fill(rate);
  return row;
}
async function save(page) {
  await page.getByRole('button', { name: 'Save expense', exact: true }).click();
  await expect(page.locator('#toast')).toHaveText('Expense saved.');
}
for (const width of [320, 1280]) {
  test(`named expense entries convert separately and persist at ${width}px`, async ({
    page,
    app,
    restartApp,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, app);
    await nav(page, 'Major expenses');
    await setMonth(page, '2026-10');
    await expect(rows(page)).toHaveCount(0);
    const car = await add(page, 'Автомобиль', '100 000', 'RSD', '117,2');
    await expect(car.locator('[data-expense-eur]')).toHaveText('€853.24');
    const refund = await add(page, 'Ремонт', '100');
    await expect(refund.locator('[data-expense-eur]')).toHaveText('€100.00');
    await expect(rows(page).locator('[data-expense-rate]')).toHaveCount(0);
    await expect(page.locator('#expenseTotal')).toHaveText('€953.24');
    await add(page, 'Отпуск', '200');
    await expect(page.locator('#expenseTotal')).toHaveText('€1,153.24');
    await save(page);
    expect(await (await page.request.get(app + '/api/months')).json()).toEqual(
      [],
    );
    const snapshot = await (
      await page.request.get(app + '/api/data/export')
    ).json();
    expect(snapshot.expenses.map((entry) => entry.name)).toEqual([
      'Автомобиль',
      'Ремонт',
      'Отпуск',
    ]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath('named-expenses.png'),
      fullPage: true,
    });
    await restartApp();
    await page.reload();
    await nav(page, 'Major expenses');
    await setMonth(page, '2026-10');
    await expect(rows(page)).toHaveCount(3);
    await expect(rows(page).first().locator('[data-expense-name]')).toHaveValue(
      'Автомобиль',
    );
    await expect(page.locator('#expenseTotal')).toHaveText('€1,153.24');
    await rows(page).first().locator('[data-expense]').fill('117200');
    await expect(rows(page).first().locator('[data-expense-eur]')).toHaveText(
      '€1,000.00',
    );
    await rows(page)
      .last()
      .getByRole('button', { name: 'Remove expense' })
      .click();
    await expect(page.locator('#expenseTotal')).toHaveText('€1,100.00');
    await save(page);
    await setMonth(page, '2026-11');
    await expect(rows(page)).toHaveCount(0);
    await add(page, 'Car', '2000');
    await save(page);
    await expect(page.locator('[data-chart-source="expense"]')).toHaveCount(2);
    await page.locator('[data-chart-source="expense"]').last().focus();
    await expect(page.locator('#chartTooltip')).toContainText('€2,000.00');
    await page.locator('#amountVisibility').click();
    await expect(rows(page).first().locator('[data-expense]')).toHaveAttribute(
      'type',
      'password',
    );
    await expect(rows(page).first().locator('[data-expense-name]')).toHaveValue(
      'Car',
    );
    await expect(
      page.locator('[data-chart-source="expense"]').last(),
    ).toHaveAttribute('aria-label', 'November 2026');
    await page.locator('[data-action="deleteExpense"]').click();
    await page.locator('#confirmCancel').click();
    await expect(rows(page)).toHaveCount(1);
    await page.locator('[data-action="deleteExpense"]').click();
    await page.locator('#confirmAccept').click();
    await expect(rows(page)).toHaveCount(0);
    await expect(page.locator('#expenseTotal')).toHaveText('€0.00');
  });
}

test('expense validates names, amounts and rates and protects unsaved edits', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Major expenses');
  const row = await add(page, '', '100');
  const saveButton = page.getByRole('button', {
    name: 'Save expense',
    exact: true,
  });
  await saveButton.click();
  await expect(page.locator('#toast')).toHaveText('Please enter a name.');
  await row.locator('[data-expense-name]').fill('Car');
  await row.locator('[data-expense]').fill('-1');
  await saveButton.click();
  await expect(page.locator('#toast')).toHaveText(
    'Expense must be zero or positive.',
  );
  await row.locator('[data-expense]').fill('100');
  await row.locator('[data-expense-currency]').selectOption('USD');
  await expect(row.locator('[data-expense-eur]')).toHaveText('—');
  await saveButton.click();
  await expect(page.locator('#toast')).toContainText('positive exchange rate');
  await nav(page, 'Dashboard');
  await page.locator('#confirmCancel').click();
  await expect(row.locator('[data-expense]')).toHaveValue('100');
  await page.locator('[data-expense-rate="USD"]').fill('2');
  await expect(page.locator('#expenseTotal')).toHaveText('€50.00');
  await row.locator('[data-expense-currency]').selectOption('EUR');
  await expect(page.locator('#expenseTotal')).toHaveText('€100.00');
  await save(page);
});

test('expense rate loading protects concurrent edits and failed saves can retry', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Major expenses');
  await setMonth(page, '2026-01');
  const row = await add(page, 'Car', '110', 'USD');
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
  await page.locator('[data-action="loadExpenseRates"]').click();
  const saveButton = page.getByRole('button', {
    name: 'Save expense',
    exact: true,
  });
  await expect(saveButton).toBeDisabled();
  await page.locator('[data-expense-rate="USD"]').fill('2.2');
  release();
  await expect(saveButton).toBeEnabled();
  await expect(page.locator('[data-expense-rate="USD"]')).toHaveValue('2.2');
  await expect(page.locator('#expenseTotal')).toHaveText('€50.00');
  await page.route('**/api/expenses/2026-01', (route) =>
    route.fulfill({ status: 500, json: { error: { code: 'internal_error' } } }),
  );
  await saveButton.click();
  await expect(page.locator('#toast')).toContainText(
    'Database or server error.',
  );
  await expect(saveButton).toBeEnabled();
  await expect(row.locator('[data-expense-name]')).toHaveValue('Car');
  await page.unroute('**/api/expenses/2026-01');
  await save(page);
});

test('loaded rates update each matching expense and its EUR equivalent', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Major expenses');
  await add(page, 'Car', '100000', 'RSD');
  await add(page, 'Renovation', '17200', 'RSD');
  await page.route('**/api/exchange-rates?*', (route) =>
    route.fulfill({ json: { date: '2026-10-30', rates: { RSD: '117.2' } } }),
  );
  await page.locator('[data-action="loadExpenseRates"]').click();
  await expect(page.locator('#expenseTotal')).toHaveText('€1,000.00');
  await save(page);
});

for (const width of [320, 1280]) {
  test(`one shared rate converts every expense in its currency at ${width}px`, async ({
    page,
    app,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, app);
    await nav(page, 'Major expenses');
    await setMonth(page, '2026-10');
    await add(page, 'Car', '100000', 'RSD', '117.2');
    await add(page, 'Renovation', '17200', 'RSD');
    await add(page, 'Travel', '100', 'EUR');
    await expect(rows(page).locator('[data-expense-rate]')).toHaveCount(0);
    await expect(page.locator('[data-expense-rate]')).toHaveCount(1);
    await expect(page.locator('#expenseRates')).toBeVisible();
    await expect(page.locator('#expenseTotal')).toHaveText('€1,100.00');
    await page.locator('[data-expense-rate="RSD"]').fill('100');
    await expect(rows(page).nth(0).locator('[data-expense-eur]')).toHaveText(
      '€1,000.00',
    );
    await expect(rows(page).nth(1).locator('[data-expense-eur]')).toHaveText(
      '€172.00',
    );
    await expect(page.locator('#expenseTotal')).toHaveText('€1,272.00');
    // Changing another row's currency keeps the shared RSD rate intact.
    await rows(page)
      .nth(1)
      .locator('[data-expense-currency]')
      .selectOption('USD');
    await expect(page.locator('[data-expense-rate]')).toHaveCount(2);
    await expect(page.locator('[data-expense-rate="RSD"]')).toHaveValue('100');
    await page.locator('[data-expense-rate="USD"]').fill('2');
    await rows(page)
      .nth(1)
      .locator('[data-expense-currency]')
      .selectOption('RSD');
    await expect(page.locator('[data-expense-rate]')).toHaveCount(1);
    await expect(page.locator('#expenseTotal')).toHaveText('€1,272.00');
    await save(page);
    const snapshot = await (
      await page.request.get(app + '/api/data/export')
    ).json();
    expect(
      snapshot.expenses
        .filter((entry) => entry.currency === 'RSD')
        .map((entry) => entry.rate),
    ).toEqual(['100', '100']);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath('shared-expense-rates.png'),
      fullPage: true,
    });
    await page.reload();
    await nav(page, 'Major expenses');
    await setMonth(page, '2026-10');
    await expect(page.locator('[data-expense-rate="RSD"]')).toHaveValue('100');
    await expect(page.locator('#expenseTotal')).toHaveText('€1,272.00');
    await setMonth(page, '2026-09');
    await expect(page.locator('#expenseRates')).toBeHidden();
    await add(page, 'Earlier car', '100000', 'RSD', '200');
    await save(page);
    await setMonth(page, '2026-10');
    await expect(page.locator('[data-expense-rate="RSD"]')).toHaveValue('100');
    await rows(page)
      .first()
      .getByRole('button', { name: 'Remove expense' })
      .click();
    await expect(page.locator('[data-expense-rate="RSD"]')).toHaveCount(1);
    await rows(page)
      .first()
      .getByRole('button', { name: 'Remove expense' })
      .click();
    await expect(page.locator('#expenseRates')).toBeHidden();
    await expect(page.locator('[data-expense-rate]')).toHaveCount(0);
    await expect(page.locator('#expenseTotal')).toHaveText('€100.00');
    await save(page);
  });
}

test('export, clear and import restore expenses and income independently', async ({
  page,
  app,
}, testInfo) => {
  await open(page, app);
  await nav(page, 'Income');
  await setMonth(page, '2026-10');
  await page.locator('[data-action="addIncomeRow"]').click();
  await page.locator('[data-income-name]').fill('Salary');
  await page.locator('[data-income]').fill('3000');
  await page.getByRole('button', { name: 'Save income', exact: true }).click();
  await expect(page.locator('#toast')).toHaveText('Income saved.');
  await nav(page, 'Major expenses');
  await setMonth(page, '2026-10');
  await add(page, 'Renovation', '117200', 'RSD', '117.2');
  await save(page);
  await nav(page, 'Settings');
  const pendingDownload = page.waitForEvent('download');
  await page.locator('[data-action="exportJSON"]').click();
  const download = await pendingDownload;
  const file = testInfo.outputPath('expenses-backup.json');
  await download.saveAs(file);
  await page.locator('[data-action="clearAllData"]').click();
  await page.locator('#clearDataPhrase').fill('DELETE');
  await page.locator('#clearDataAccept').click();
  await expect(page.getByText('Welcome to Capital Tracker')).toBeVisible();
  await nav(page, 'Major expenses');
  await setMonth(page, '2026-10');
  await expect(rows(page)).toHaveCount(0);
  await nav(page, 'Settings');
  await page.locator('#jsonFileInput').setInputFiles(file);
  await expect(page.locator('#confirmDialog')).toBeVisible();
  await page.locator('#confirmAccept').click();
  await expect(page.locator('#toast')).toContainText(
    'JSON data imported successfully',
  );
  await nav(page, 'Major expenses');
  await setMonth(page, '2026-10');
  await expect(rows(page).first().locator('[data-expense-name]')).toHaveValue(
    'Renovation',
  );
  await expect(page.locator('[data-expense-rate="RSD"]')).toHaveValue('117.2');
  await expect(page.locator('#expenseTotal')).toHaveText('€1,000.00');
  await nav(page, 'Income');
  await expect(page.locator('#incomeTotal')).toHaveText('€3,000.00');
});
