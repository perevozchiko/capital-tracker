const { test, expect, open, nav, setMonth } = require('./helpers.cjs');
const rows = (page) => page.locator('[data-income-row]');
async function add(page, name, amount, currency = 'EUR', rate = '') {
  await page.locator('#incomeName').fill(name);
  await page.locator('#incomeAmount').fill(amount);
  await page.locator('#incomeCurrency').selectOption(currency);
  await page.getByRole('button', { name: 'Add income', exact: true }).click();
  const row = rows(page).last();
  await expect(page.locator('#incomeName')).toBeFocused();
  await expect(row.locator('input, select, textarea')).toHaveCount(0);
  await expect(row.locator('[data-income-name]')).toHaveText(name);
  if (rate) await page.locator(`[data-income-rate="${currency}"]`).fill(rate);
  return row;
}
async function save(page) {
  await page.getByRole('button', { name: 'Save income', exact: true }).click();
  await expect(page.locator('#toast')).toHaveText('Income saved.');
}
for (const width of [320, 1280]) {
  test(`named income entries convert separately and persist at ${width}px`, async ({
    page,
    app,
    restartApp,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, app);
    await nav(page, 'Income');
    await setMonth(page, '2026-10');
    await expect(rows(page)).toHaveCount(0);
    await expect(page.locator('#addIncomeForm')).toBeVisible();
    await expect(page.locator('#incomeListEmpty')).toBeVisible();
    const salary = await add(page, 'Зарплата', '100 000', 'RSD', '117,2');
    await expect(salary.locator('[data-income-eur]')).toHaveText('€853.24');
    await expect(page.locator('#incomeName')).toHaveValue('');
    await expect(page.locator('#incomeAmount')).toHaveValue('');
    await expect(page.locator('#incomeCurrency')).toHaveValue('EUR');
    await expect(page.locator('#incomeListEmpty')).toBeHidden();
    const refund = await add(page, 'Возврат со страховой', '100');
    await expect(refund.locator('[data-income-eur]')).toHaveText('€100.00');
    await expect(rows(page).locator('[data-income-rate]')).toHaveCount(0);
    await expect(page.locator('#incomeTotal')).toHaveText('€953.24');
    await add(page, 'Бонус', '200');
    await expect(page.locator('#incomeTotal')).toHaveText('€1,153.24');
    await save(page);
    expect(await (await page.request.get(app + '/api/months')).json()).toEqual(
      [],
    );
    const snapshot = await (
      await page.request.get(app + '/api/data/export')
    ).json();
    expect(snapshot.incomes.map((entry) => entry.name)).toEqual([
      'Зарплата',
      'Возврат со страховой',
      'Бонус',
    ]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath('named-incomes.png'),
      fullPage: true,
    });
    await restartApp();
    await page.reload();
    await nav(page, 'Income');
    await setMonth(page, '2026-10');
    await expect(rows(page)).toHaveCount(3);
    await expect(rows(page).first().locator('[data-income-name]')).toHaveText(
      'Зарплата',
    );
    await expect(page.locator('#incomeTotal')).toHaveText('€1,153.24');
    await expect(rows(page).locator('input, select, textarea')).toHaveCount(0);
    await rows(page)
      .first()
      .getByRole('button', { name: 'Remove income' })
      .click();
    const replacement = await add(page, 'Зарплата', '117200', 'RSD');
    await expect(replacement.locator('[data-income-eur]')).toHaveText(
      '€1,000.00',
    );
    await rows(page)
      .nth(1)
      .getByRole('button', { name: 'Remove income' })
      .click();
    await expect(page.locator('#incomeTotal')).toHaveText('€1,100.00');
    await save(page);
    await setMonth(page, '2026-11');
    await expect(rows(page)).toHaveCount(0);
    await add(page, 'Salary', '2000');
    await save(page);
    await expect(page.locator('[data-chart-source="income"]')).toHaveCount(2);
    await page.locator('[data-chart-source="income"]').last().focus();
    await expect(page.locator('#chartTooltip')).toContainText('€2,000.00');
    await page.locator('#amountVisibility').click();
    await expect(
      rows(page).first().locator('[data-income-amount] .money-text'),
    ).toBeHidden();
    await expect(
      rows(page).first().locator('[data-income-eur] .money-text'),
    ).toBeHidden();
    await expect(rows(page).first().locator('[data-income-name]')).toHaveText(
      'Salary',
    );
    await expect(
      page.locator('[data-chart-source="income"]').last(),
    ).toHaveAttribute('aria-label', 'November 2026');
    await page.locator('[data-action="deleteIncome"]').click();
    await page.locator('#confirmCancel').click();
    await expect(rows(page)).toHaveCount(1);
    await page.locator('[data-action="deleteIncome"]').click();
    await page.locator('#confirmAccept').click();
    await expect(rows(page)).toHaveCount(0);
    await expect(page.locator('#incomeTotal')).toHaveText('€0.00');
    await expect(page.locator('#incomeListEmpty')).toBeVisible();
  });
}

test('income validates rates and protects unsaved entries', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Income');
  const row = await add(page, 'Salary', '100', 'USD', '1');
  const saveButton = page.getByRole('button', {
    name: 'Save income',
    exact: true,
  });
  await page.locator('[data-income-rate="USD"]').fill('');
  await expect(row.locator('[data-income-eur]')).toHaveText('—');
  await saveButton.click();
  await expect(page.locator('#toast')).toContainText('positive exchange rate');
  await nav(page, 'Dashboard');
  await page.locator('#confirmCancel').click();
  await expect(row.locator('[data-income-amount]')).toHaveText('$100.00');
  await page.locator('[data-income-rate="USD"]').fill('2');
  await expect(page.locator('#incomeTotal')).toHaveText('€50.00');
  await row.getByRole('button', { name: 'Remove income' }).click();
  await add(page, 'Salary', '100', 'EUR');
  await expect(page.locator('#incomeTotal')).toHaveText('€100.00');
  await save(page);
});

test('income rate loading protects concurrent edits and failed saves can retry', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Income');
  await setMonth(page, '2026-01');
  const row = await add(page, 'Salary', '110', 'USD');
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
  await page.locator('[data-action="loadIncomeRates"]').click();
  const saveButton = page.getByRole('button', {
    name: 'Save income',
    exact: true,
  });
  await expect(saveButton).toBeDisabled();
  await page.locator('[data-income-rate="USD"]').fill('2.2');
  release();
  await expect(saveButton).toBeEnabled();
  await expect(page.locator('[data-income-rate="USD"]')).toHaveValue('2.2');
  await expect(page.locator('#incomeTotal')).toHaveText('€50.00');
  await page.route('**/api/incomes/2026-01', (route) =>
    route.fulfill({ status: 500, json: { error: { code: 'internal_error' } } }),
  );
  await saveButton.click();
  await expect(page.locator('#toast')).toContainText(
    'Database or server error.',
  );
  await expect(saveButton).toBeEnabled();
  await expect(row.locator('[data-income-name]')).toHaveText('Salary');
  await page.unroute('**/api/incomes/2026-01');
  await save(page);
});

test('loaded rates update each matching income and its EUR equivalent', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Income');
  await add(page, 'Salary', '100000', 'RSD');
  await add(page, 'Bonus', '17200', 'RSD');
  await page.route('**/api/exchange-rates?*', (route) =>
    route.fulfill({ json: { date: '2026-10-30', rates: { RSD: '117.2' } } }),
  );
  await page.locator('[data-action="loadIncomeRates"]').click();
  await expect(page.locator('#incomeTotal')).toHaveText('€1,000.00');
  await save(page);
});

for (const width of [320, 1280]) {
  test(`one shared rate converts every income in its currency at ${width}px`, async ({
    page,
    app,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, app);
    await nav(page, 'Income');
    await setMonth(page, '2026-10');
    await add(page, 'Salary', '100000', 'RSD', '117.2');
    await add(page, 'Bonus', '17200', 'RSD');
    await add(page, 'Refund', '100', 'EUR');
    await expect(rows(page).locator('[data-income-rate]')).toHaveCount(0);
    await expect(page.locator('[data-income-rate]')).toHaveCount(1);
    await expect(page.locator('#incomeRates')).toBeVisible();
    await expect(page.locator('#incomeTotal')).toHaveText('€1,100.00');
    await page.locator('[data-income-rate="RSD"]').fill('100');
    await expect(rows(page).nth(0).locator('[data-income-eur]')).toHaveText(
      '€1,000.00',
    );
    await expect(rows(page).nth(1).locator('[data-income-eur]')).toHaveText(
      '€172.00',
    );
    await expect(page.locator('#incomeTotal')).toHaveText('€1,272.00');
    // Adding another currency keeps the shared RSD rate intact.
    const temporary = await add(page, 'Temporary income', '20', 'USD');
    await expect(page.locator('[data-income-rate]')).toHaveCount(2);
    await expect(page.locator('[data-income-rate="RSD"]')).toHaveValue('100');
    await page.locator('[data-income-rate="USD"]').fill('2');
    await temporary.getByRole('button', { name: 'Remove income' }).click();
    await expect(page.locator('[data-income-rate]')).toHaveCount(1);
    await expect(page.locator('#incomeTotal')).toHaveText('€1,272.00');
    await save(page);
    const snapshot = await (
      await page.request.get(app + '/api/data/export')
    ).json();
    expect(
      snapshot.incomes
        .filter((entry) => entry.currency === 'RSD')
        .map((entry) => entry.rate),
    ).toEqual(['100', '100']);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath('shared-income-rates.png'),
      fullPage: true,
    });
    await page.reload();
    await nav(page, 'Income');
    await setMonth(page, '2026-10');
    await expect(page.locator('[data-income-rate="RSD"]')).toHaveValue('100');
    await expect(page.locator('#incomeTotal')).toHaveText('€1,272.00');
    await setMonth(page, '2026-09');
    await expect(page.locator('#incomeRates')).toBeHidden();
    await add(page, 'Earlier salary', '100000', 'RSD', '200');
    await save(page);
    await setMonth(page, '2026-10');
    await expect(page.locator('[data-income-rate="RSD"]')).toHaveValue('100');
    await rows(page)
      .first()
      .getByRole('button', { name: 'Remove income' })
      .click();
    await expect(page.locator('[data-income-rate="RSD"]')).toHaveCount(1);
    await rows(page)
      .first()
      .getByRole('button', { name: 'Remove income' })
      .click();
    await expect(page.locator('#incomeRates')).toBeHidden();
    await expect(page.locator('[data-income-rate]')).toHaveCount(0);
    await expect(page.locator('#incomeTotal')).toHaveText('€100.00');
    await save(page);
  });
}

test('income creation validates the form before adding an entry', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Income');
  const addButton = page.locator('#addIncomeForm button');
  await addButton.click();
  await expect(rows(page)).toHaveCount(0);
  await page.locator('#incomeName').fill('   ');
  await page.locator('#incomeAmount').fill('100');
  await addButton.click();
  await expect(page.locator('#toast')).toHaveText('Please enter a name.');
  await expect(rows(page)).toHaveCount(0);
  await page.locator('#incomeName').fill('Salary');
  await page.locator('#incomeAmount').fill('-1');
  await addButton.click();
  await expect(page.locator('#toast')).toHaveText(
    'Income must be zero or positive.',
  );
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator('#incomeName')).toHaveValue('Salary');
  await page.locator('#incomeAmount').fill('0');
  await page.locator('#incomeAmount').press('Enter');
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator('#incomeTotal')).toHaveText('€0.00');
  await rows(page).getByRole('button', { name: 'Remove income' }).click();
  await expect(page.locator('#incomeListEmpty')).toBeVisible();
});
