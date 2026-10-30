const {
  test,
  expect,
  open,
  nav,
  createAccount,
  setMonth,
} = require('./helpers.cjs');

test.use({ timezoneId: 'Europe/Belgrade' });

for (const width of [320, 1280]) {
  test(`current month uses local time on every screen at ${width}px`, async ({
    page,
    app,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    // February in Belgrade, while UTC is still in January.
    await page.clock.setFixedTime(new Date('2026-01-31T23:30:00Z'));
    await open(page, app);
    for (const screen of ['Dashboard', 'Accounts', 'Monthly balances']) {
      await nav(page, screen);
      await setMonth(page, '2025-01');
      await expect(page.locator('.month-picker')).toHaveValue('2025-01');
      const current = page.getByRole('button', {
        name: 'Current month',
        exact: true,
      });
      await expect(current).toBeInViewport();
      await current.click();
      await expect(page.locator('.month-picker')).toHaveValue('2026-02');
      await expect(page.locator('.month-switch label')).toHaveText(
        'February 2026',
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        ),
      ).toBeLessThanOrEqual(1);
    }
    // The button computes the current month when clicked, even after midnight.
    await page.clock.setFixedTime(new Date('2026-02-28T23:30:00Z'));
    await page
      .getByRole('button', { name: 'Current month', exact: true })
      .click();
    await expect(page.locator('.month-picker')).toHaveValue('2026-03');
  });
}

test('current month respects unsaved edits and preserves edits in the same month', async ({
  page,
  app,
}) => {
  await page.clock.setFixedTime(new Date('2026-10-15T12:00:00Z'));
  await open(page, app);
  await nav(page, 'Accounts');
  await createAccount(page, 'Wallet');
  await nav(page, 'Monthly balances');
  await setMonth(page, '2025-01');
  const balance = page.locator('[data-balance="1"]');
  const current = page.getByRole('button', {
    name: 'Current month',
    exact: true,
  });
  await balance.fill('123.45');
  await current.click();
  await expect(page.locator('#confirmDialog')).toBeVisible();
  await page.locator('#confirmCancel').click();
  await expect(page.locator('.month-picker')).toHaveValue('2025-01');
  await expect(balance).toHaveValue('123.45');
  await current.click();
  await page.locator('#confirmAccept').click();
  await expect(page.locator('.month-picker')).toHaveValue('2026-10');
  await expect(balance).toHaveValue('');
  await balance.fill('456.78');
  await current.click();
  await expect(page.locator('#confirmDialog')).not.toBeVisible();
  await expect(balance).toHaveValue('456.78');
  await nav(page, 'Accounts');
  await expect(page.locator('#confirmDialog')).toBeVisible();
  await page.locator('#confirmCancel').click();
  await expect(balance).toHaveValue('456.78');
});
