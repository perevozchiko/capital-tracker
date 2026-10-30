const {
  test,
  expect,
  open,
  nav,
  createAccount,
  createGroup,
  accountGroup,
  saveBalances,
  setMonth,
  action,
  editDialog,
} = require('./helpers.cjs');

for (const width of [320, 1280]) {
  test(`monthly groups show active accounts without Archive at ${width}px`, async ({
    page,
    app,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await open(page, app);
    await nav(page, 'Accounts');
    await createGroup(page, 'Savings');
    await page.locator('#accountGroup').selectOption({ label: 'Savings' });
    await createAccount(page, 'Former bank', 'USD');
    await page.locator('#accountGroup').selectOption({ label: 'Ungrouped' });
    await createAccount(page, 'Current wallet');
    await nav(page, 'Monthly balances');
    await saveBalances(page, '2025-01', { 1: '110', 2: '25' }, { USD: '1.1' });
    await saveBalances(page, '2025-02', { 1: '0', 2: '25' }, { USD: '1.1' });
    await nav(page, 'Accounts');
    await action(page, 'Former bank', 'archive');
    await editDialog(page, '2025-03');
    await expect(accountGroup(page, 'Archive')).toContainText('Former bank');
    await nav(page, 'Monthly balances');

    for (const month of ['2025-01', '2025-03']) {
      await setMonth(page, month);
      await expect(
        page.locator('.monthly-group .group-caption > strong'),
      ).toHaveText(['Savings', 'Ungrouped']);
      await expect(accountGroup(page, 'Archive')).toHaveCount(0);
      const bank = accountGroup(page, 'Savings').locator('[data-balance="1"]');
      if (month === '2025-01') {
        await expect(bank).toHaveValue('110.00');
        await expect(
          accountGroup(page, 'Savings').locator('.group-total strong'),
        ).toHaveText('€100.00');
        await page.locator('[data-balance="2"]').fill('50');
        await page.locator('[data-action="saveMonth"]').click();
        await expect(page.locator('.status-block')).toContainText('€150.00');
        const saved = await (
          await page.request.get(app + '/api/months/' + month)
        ).json();
        expect(saved.balances).toContainEqual({
          account_id: 1,
          amount_minor: '11000',
        });
      } else {
        await expect(bank).toHaveCount(0);
        await expect(page.locator('[data-rate="USD"]')).toHaveCount(0);
      }
      await expect(page.locator('[data-balance="2"]')).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth - innerWidth,
          ),
        )
        .toBeLessThanOrEqual(1);
      for (const panel of await page.locator('.monthly-group').all()) {
        await expect(panel).toBeVisible();
        const bounds = await panel.boundingBox();
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      }
      await page.screenshot({
        path: testInfo.outputPath(`monthly-${month}.png`),
        fullPage: true,
        animations: 'disabled',
      });
    }
    await page.reload();
    await nav(page, 'Monthly balances');
    await expect(accountGroup(page, 'Archive')).toHaveCount(0);
  });
}
