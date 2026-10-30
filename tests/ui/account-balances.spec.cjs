const {
  test,
  expect,
  open,
  nav,
  createAccount,
  saveBalances,
  setMonth,
  createGroup,
  action,
  editDialog,
} = require('./helpers.cjs');

async function savePartialBalances(page, month, values, rates) {
  await setMonth(page, month);
  for (const [id, value] of Object.entries(values))
    await page.locator(`[data-balance="${id}"]`).fill(value);
  for (const [currency, value] of Object.entries(rates))
    await page.locator(`[data-rate="${currency}"]`).fill(value);
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/months/' + month) &&
      response.request().method() === 'PUT',
  );
  await page.locator('[data-action="saveMonth"]').click();
  expect((await saved).ok()).toBe(true);
  await expect(page.locator('#toast')).toContainText('Partial month saved.');
}

for (const width of [320, 1280]) {
  test(`account rows show selected-month balances, zero and missing values at ${width}px`, async ({
    page,
    app,
  }) => {
    await page.setViewportSize({ width, height: 850 });
    await open(page, app);
    await nav(page, 'Accounts');
    await createGroup(page, 'Savings');
    await page.locator('#accountGroup').selectOption({ label: 'Savings' });
    await createAccount(page, 'Euro account');
    await createAccount(page, 'Dollar debt', 'USD');
    await createAccount(page, 'Missing balance');
    await createAccount(page, 'Future account', 'EUR', '2025-03');
    await nav(page, 'Monthly balances');
    await savePartialBalances(
      page,
      '2025-01',
      { 1: '10000000.99', 2: '-123.45' },
      { USD: '1.1' },
    );
    await savePartialBalances(
      page,
      '2025-02',
      { 1: '0', 2: '-250.01' },
      { USD: '1.2' },
    );
    await nav(page, 'Accounts');
    const balance = (id) =>
      page.locator(`[data-account-row="${id}"] .account-balance strong`);
    await expect(balance(1)).toHaveText('€0.00');
    await expect(balance(2)).toHaveText('-$250.01');
    await expect(balance(3)).toHaveText('—');
    await expect(balance(4)).toHaveText('—');
    await expect(page.locator('.account-balance small').first()).toHaveText(
      'Feb 2025',
    );
    await setMonth(page, '2025-01');
    await expect(balance(1)).toHaveText('€10,000,000.99');
    await expect(balance(2)).toHaveText('-$123.45');
    await expect(page.locator('.account-balance small').first()).toHaveText(
      'Jan 2025',
    );
    await expect(balance(1).locator('.money-text')).toBeVisible();
    const rect = await balance(1).boundingBox();
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(width);
    await page.locator('#amountVisibility').click();
    await expect(balance(1).locator('.money-text')).toBeHidden();
    await expect(balance(2).locator('.money-text')).toBeHidden();
    await setMonth(page, '2025-02');
    await expect(balance(1)).toHaveText('€0.00');
    await expect(balance(1).locator('.money-text')).toBeHidden();
    await page.locator('#amountVisibility').click();
    await expect(balance(1).locator('.money-text')).toBeVisible();
    await expect(balance(2).locator('.money-text')).toBeVisible();
    await setMonth(page, '2025-04');
    await expect(balance(1)).toHaveText('—');
    await expect(balance(2)).toHaveText('—');
    await expect(page.locator('.account-balance .money-text')).toHaveCount(0);
  });
}

test('archived accounts display recorded balances for the selected historical month', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Accounts');
  await createAccount(page, 'Archived savings');
  await nav(page, 'Monthly balances');
  await saveBalances(page, '2025-01', { 1: '42.25' });
  await saveBalances(page, '2025-02', { 1: '0' });
  await nav(page, 'Accounts');
  await action(page, 'Archived savings', 'archive');
  await editDialog(page, '2025-03');
  await setMonth(page, '2025-01');
  const balance = page.locator(
    '[data-group-id="archive"] .account-balance strong',
  );
  await expect(balance).toHaveText('€42.25');
  await expect(balance.locator('.money-text')).toBeVisible();
  await page.locator('#amountVisibility').click();
  await expect(balance.locator('.money-text')).toBeHidden();
  await setMonth(page, '2025-03');
  await expect(balance).toHaveText('—');
});

for (const value of ['', '1', '-1']) {
  test(`archive rejects ${value === '' ? 'missing' : value} balance and succeeds after saving zero`, async ({
    page,
    app,
  }) => {
    await open(page, app);
    await nav(page, 'Accounts');
    await createAccount(page, 'Closing account');
    await nav(page, 'Monthly balances');
    if (value === '')
      await savePartialBalances(page, '2025-01', { 1: value }, {});
    else await saveBalances(page, '2025-01', { 1: value });
    await nav(page, 'Accounts');
    await action(page, 'Closing account', 'archive');
    await page.locator('#editValue').fill('2025-02');
    await page.locator('#confirmEdit').click();
    await expect(page.locator('#toast')).toContainText(
      'save a zero balance in the latest recorded month first',
    );
    await expect(page.locator('#accountDialog')).toBeVisible();
    await expect(
      page.locator('[data-group-id="archive"] .account-row'),
    ).toHaveCount(0);
    await page.locator('#cancelEdit').click();
    await nav(page, 'Monthly balances');
    await saveBalances(page, '2025-01', { 1: '0' });
    await nav(page, 'Accounts');
    await action(page, 'Closing account', 'archive');
    await editDialog(page, '2025-02');
    await expect(
      page.locator('[data-group-id="archive"] .account-row'),
    ).toContainText('Closing account');
  });
}
