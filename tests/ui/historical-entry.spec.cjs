const {
  test,
  expect,
  open,
  nav,
  createAccount,
  saveBalances,
  setMonth,
} = require('./helpers.cjs');

test('backfill and edit a month before account creation while retaining its first saved quote', async ({
  page,
  app,
  restartApp,
}) => {
  await open(page, app);
  await nav(page, 'Accounts');
  await createAccount(page, 'USD savings', 'USD', '2026-10');
  await createAccount(page, 'Future EUR', 'EUR', '2026-12');
  await createAccount(page, 'Future RUB', 'RUB', '2026-12');
  await nav(page, 'Monthly balances');
  await saveBalances(page, '2026-10', { 1: '220' }, { USD: '1.1' });
  await setMonth(page, '2025-09');
  await expect(page.locator('[data-balance="1"]')).toBeVisible();
  await expect(page.locator('[data-action="saveMonth"]')).toBeEnabled();
  let quotes = 0;
  await page.route('**/api/exchange-rates?*', (route) => {
    quotes++;
    return route.fulfill({
      json: {
        date: '2026-10-30',
        rates: { USD: quotes === 1 ? '1.25' : '2.5', RUB: '100' },
      },
    });
  });
  await page.locator('[data-action="loadRates"]').click();
  await expect(page.locator('[data-rate="USD"]')).toHaveValue('1.25');
  await saveBalances(page, '2025-09', { 1: '125' });
  await expect(page.locator('[data-rate="USD"]')).toHaveAttribute(
    'readonly',
    '',
  );
  await saveBalances(page, '2025-09', { 1: '250' });
  const stored = await (
    await page.request.get(app + '/api/months/2025-09')
  ).json();
  expect(stored.complete).toBe(true);
  expect(stored.total_eur_minor).toBe('20000');
  expect(stored.rates).toEqual([{ currency: 'USD', rate: '1.25' }]);
  const accounts = await (await page.request.get(app + '/api/accounts')).json();
  expect(accounts.find((a) => a.id === 1).start_month).toBe('2025-09');
  expect(accounts.find((a) => a.id === 2).start_month).toBe('2026-12');
  expect(accounts.find((a) => a.id === 3).start_month).toBe('2026-12');
  await restartApp();
  await page.reload();
  await nav(page, 'Monthly balances');
  await setMonth(page, '2025-09');
  await expect(page.locator('[data-balance="1"]')).toHaveValue('250.00');
  await expect(page.locator('[data-rate="USD"]')).toHaveValue('1.25');
  await expect(page.locator('[data-rate="USD"]')).toHaveAttribute(
    'readonly',
    '',
  );
  expect(quotes).toBe(1);
  await setMonth(page, '2026-10');
  await expect(page.locator('[data-balance="1"]')).toHaveValue('220.00');
  await expect(page.locator('[data-rate="USD"]')).toHaveValue('1.1');
});
