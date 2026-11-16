const {
  test,
  expect,
  open,
  nav,
  createAccount,
  saveBalances,
  action,
  row,
} = require('./helpers.cjs');

test('debts are typed as positive amounts and split the dashboard balance', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Accounts');
  await createAccount(page, 'Bank');
  await page.locator('#accountKind').selectOption('liability');
  await createAccount(page, 'Mortgage');
  await page.locator('#accountKind').selectOption('receivable');
  await createAccount(page, 'Lent to Sam');
  await expect(row(page, 'Bank').locator('.kind-tag')).toHaveCount(0);
  await expect(row(page, 'Mortgage').locator('.kind-tag')).toHaveText('Debt');
  await expect(row(page, 'Lent to Sam').locator('.kind-tag')).toHaveText(
    'Owed to you',
  );

  await nav(page, 'Monthly balances');
  await saveBalances(page, '2025-01', { 1: '500', 2: '400', 3: '200' });
  await saveBalances(page, '2025-02', { 1: '500', 2: '300', 3: '200' });

  // The amount owed stays positive on screen and a shrinking debt is good news.
  await expect(page.locator('[data-balance="2"]')).toHaveValue('300.00');
  const debtChange = page.locator('[data-balance-change="2"]');
  await expect(debtChange).toHaveText('-€100.00');
  await expect(debtChange).toHaveClass(/positive/);

  // It is stored as a negative contribution to net worth.
  const saved = await (
    await page.request.get(app + '/api/months/2025-02')
  ).json();
  expect(saved.balances.find((b) => b.account_id === 2).amount_minor).toBe(
    '-30000',
  );
  expect(saved.total_eur_minor).toBe('40000');
  expect(saved.assets_eur_minor).toBe('70000');
  expect(saved.liabilities_eur_minor).toBe('30000');
  expect(saved.receivables_eur_minor).toBe('20000');
  expect(saved.debt_ratio_bp).toBe('4286');

  await nav(page, 'Accounts');
  const balance = (name) => row(page, name).locator('.account-balance strong');
  await expect(balance('Mortgage')).toHaveText('€300.00');

  await nav(page, 'Dashboard');
  await expect(page.locator('.metric').first()).toContainText('€400.00');
  const card = (key) => page.locator(`[data-breakdown="${key}"]`);
  await expect(card('assets').locator('.breakdown-total')).toHaveText(
    '€700.00',
  );
  await expect(card('debts').locator('.breakdown-total')).toHaveText('€300.00');
  await expect(card('debts').locator('.breakdown-change')).toContainText(
    '-€100.00',
  );
  await expect(card('debts').locator('.breakdown-change')).toHaveClass(
    /positive/,
  );
  await expect(card('debts').locator('.debt-ratio')).toHaveText('42.86%');
  await expect(card('receivables').locator('.breakdown-total')).toHaveText(
    '€200.00',
  );
  await expect(page.locator('.chart-dot')).toHaveCount(2);
  await expect(page.locator('.debt-dot')).toHaveCount(2);
  await expect(page.locator('.debt-curve')).toHaveCount(1);
  await page.locator('.debt-dot').first().focus();
  await expect(page.locator('#chartTooltip')).toContainText('Debts: €400.00');

  // Reclassifying keeps the saved balance and the total; only the split moves.
  await nav(page, 'Accounts');
  await action(page, 'Mortgage', 'kind');
  await page.locator('#editValue').selectOption('asset');
  await page.locator('#confirmEdit').click();
  await expect(page.locator('#accountDialog')).not.toBeVisible();
  await expect(row(page, 'Mortgage').locator('.kind-tag')).toHaveCount(0);
  await expect(balance('Mortgage')).toHaveText('-€300.00');
  await nav(page, 'Dashboard');
  await expect(page.locator('.metric').first()).toContainText('€400.00');
  await expect(card('debts').locator('.breakdown-total')).toHaveText('€0.00');
  await expect(page.locator('.debt-dot')).toHaveCount(0);
});

test('the assets and debts split stays hidden without debt accounts', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Accounts');
  await createAccount(page, 'Bank');
  await nav(page, 'Monthly balances');
  await saveBalances(page, '2025-01', { 1: '-50' });
  await nav(page, 'Dashboard');
  await expect(page.locator('.metric').first()).toContainText('-€50.00');
  await expect(page.locator('.dashboard-breakdown')).toHaveCount(0);
  await expect(page.locator('.debt-dot')).toHaveCount(0);
});
