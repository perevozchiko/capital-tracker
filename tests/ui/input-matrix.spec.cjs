const {
  test,
  expect,
  open,
  nav,
  createAccount,
  setMonth,
} = require('./helpers.cjs');
async function editor(page, app, currency = 'EUR') {
  await open(page, app);
  await nav(page, 'Accounts');
  await createAccount(page, 'Account', currency);
  await nav(page, 'Monthly balances');
  await setMonth(page, '2025-01');
  if (currency !== 'EUR')
    await page.locator(`[data-rate="${currency}"]`).fill('1');
}
for (const currency of ['EUR', 'USD', 'RSD', 'RUB', 'TRY']) {
  for (const [name, input, minor, normalized] of [
    ['zero', '0', '0', '0.00'],
    ['negative', '-1.01', '-101', '-1.01'],
    ['comma', '100,50', '10050', '100.50'],
    ['grouping', '1 234.56', '123456', '1234.56'],
    [
      'positive limit',
      '90000000000000',
      '9000000000000000',
      '90000000000000.00',
    ],
    [
      'negative limit',
      '-90000000000000',
      '-9000000000000000',
      '-90000000000000.00',
    ],
  ]) {
    test(`${currency} balance ${name} saves exactly and survives restart`, async ({
      page,
      app,
      restartApp,
    }) => {
      await editor(page, app, currency);
      await page.locator('[data-balance="1"]').fill(input);
      await page.locator('[data-action="saveMonth"]').click();
      await expect(page.locator('.status-block')).toContainText('Complete');
      await restartApp();
      await page.reload();
      await nav(page, 'Monthly balances');
      await setMonth(page, '2025-01');
      await expect(page.locator('[data-balance="1"]')).toHaveValue(normalized);
      const stored = await (
        await page.request.get(app + '/api/months/2025-01')
      ).json();
      expect(stored.balances).toEqual([{ account_id: 1, amount_minor: minor }]);
      expect(stored.total_eur_minor).toBe(minor);
    });
  }
}
for (const input of [
  'NaN',
  '1e3',
  '1.001',
  '1,000.00',
  '--1',
  '1 23',
  '90000000000000.01',
  '-90000000000000.01',
]) {
  test(`invalid balance ${input} cannot replace a saved amount and can be corrected`, async ({
    page,
    app,
  }) => {
    await editor(page, app);
    await page.locator('[data-balance="1"]').fill('123.45');
    await page.locator('[data-action="saveMonth"]').click();
    await expect(page.locator('.status-block')).toContainText('Complete');
    await page.locator('[data-balance="1"]').fill(input);
    await page.locator('[data-action="saveMonth"]').click();
    await expect(page.locator('[data-balance="1"]')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    const stored = await (
      await page.request.get(app + '/api/months/2025-01')
    ).json();
    expect(stored.balances[0].amount_minor).toBe('12345');
    await page.locator('[data-balance="1"]').fill('0');
    await page.locator('[data-action="saveMonth"]').click();
    await expect(page.locator('.status-block')).toContainText('€0.00');
  });
}
for (const [input, normalized] of [
  ['1', '1'],
  ['1,085', '1.085'],
  ['0.00000001', '0.00000001'],
  ['100000000', '100000000'],
  ['001.23000000', '1.23'],
  ['117 200.12345678', '117200.12345678'],
]) {
  test(`valid exchange rate ${input} round-trips without precision loss`, async ({
    page,
    app,
  }) => {
    await editor(page, app, 'USD');
    await page.locator('[data-balance="1"]').fill('1');
    await page.locator('[data-rate="USD"]').fill(input);
    await page.locator('[data-action="saveMonth"]').click();
    await expect(page.locator('.status-block')).toContainText('Complete');
    await page.reload();
    await nav(page, 'Monthly balances');
    await setMonth(page, '2025-01');
    await expect(page.locator('[data-rate="USD"]')).toHaveValue(normalized);
  });
}
for (const input of [
  '0',
  '-1',
  '1e3',
  '1.123456789',
  '100000000.00000001',
  '0.000000001',
  'NaN',
  '1,000.00',
]) {
  test(`invalid exchange rate ${input} cannot change stored history`, async ({
    page,
    app,
  }) => {
    await editor(page, app, 'USD');
    await page.locator('[data-balance="1"]').fill('110');
    await page.locator('[data-rate="USD"]').fill('1.1');
    await page.locator('[data-action="saveMonth"]').click();
    await expect(page.locator('.status-block')).toContainText('Complete');
    await setMonth(page, '2025-02');
    await page.locator('[data-balance="1"]').fill('110');
    await page.locator('[data-rate="USD"]').fill(input);
    await page.locator('[data-action="saveMonth"]').click();
    await expect(page.locator('[data-rate="USD"]')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    const stored = await (
      await page.request.get(app + '/api/months/2025-01')
    ).json();
    expect(stored.rates).toEqual([{ currency: 'USD', rate: '1.1' }]);
    expect(stored.total_eur_minor).toBe('10000');
  });
}
