const {
  test,
  expect,
  open,
  nav,
  createAccount,
  saveBalances,
  action,
} = require('./helpers.cjs');

for (const width of [320, 1280]) {
  test(`amount visibility covers every screen and preserves edits at ${width}px`, async ({
    page,
    app,
  }) => {
    await page.setViewportSize({ width, height: 850 });
    await open(page, app);
    await nav(page, 'Accounts');
    await createAccount(page, 'Savings');
    await nav(page, 'Monthly balances');
    await saveBalances(page, '2025-01', { 1: '1000' });
    await saveBalances(page, '2025-02', { 1: '1200' });
    await nav(page, 'Dashboard');
    await expect(page.locator('.metric-secondary')).toContainText('+20.00%');
    await page
      .getByRole('button', { name: 'Hide amounts', exact: true })
      .click();
    await expect(page.locator('#amountVisibility')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('.metric-secondary')).toContainText('+20.00%');
    await expect(page.locator('.money-text:visible')).toHaveCount(0);
    await expect(page.locator('.money-axis:visible')).toHaveCount(0);
    await expect(page.locator('.chart-dot').first()).not.toHaveAttribute(
      'aria-label',
      /€/,
    );
    await page.locator('.chart-dot').first().focus();
    await expect(page.locator('#chartTooltip')).toBeVisible();
    await expect(page.locator('#chartTooltip .money-text')).toBeHidden();
    await nav(page, 'Accounts');
    await expect(page.locator('.group-total .money-text:visible')).toHaveCount(
      0,
    );
    await action(page, 'Savings', 'history');
    await expect(page.locator('tbody .money-text')).toHaveCount(2);
    await expect(page.locator('tbody .money-text:visible')).toHaveCount(0);
    await nav(page, 'Settings');
    await expect(
      page.getByRole('button', { name: 'Show amounts', exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Show amounts', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.money-text:visible')).toHaveCount(0);
    await nav(page, 'Monthly balances');
    const balance = page.locator('[data-balance="1"]');
    await expect(balance).toHaveAttribute('type', 'password');
    await balance.fill('1350.25');
    await page
      .getByRole('button', { name: 'Show amounts', exact: true })
      .click();
    await expect(balance).toHaveAttribute('type', 'text');
    await expect(balance).toHaveValue('1350.25');
    await expect(page.locator('.balance-change')).toHaveText('+€350.25');
    await expect(page.locator('.balance-previous strong')).toHaveText(
      '€1,000.00',
    );
    await expect(page.locator('#confirmDialog')).not.toBeVisible();
    await page
      .getByRole('button', { name: 'Hide amounts', exact: true })
      .click();
    await expect(balance).toHaveValue('1350.25');
    await expect(page.locator('.balance-change .money-text')).toBeHidden();
    await page.locator('[data-action="saveMonth"]').click();
    await expect(page.locator('#toast')).toContainText('Month saved.');
    await expect(balance).toHaveAttribute('type', 'password');
    await expect(balance).toHaveValue('1350.25');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test('keyboard toggle restores chart labels, foreign balances and negative percentages', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Accounts');
  await createAccount(page, 'Dollar savings', 'USD');
  await nav(page, 'Monthly balances');
  await saveBalances(page, '2025-01', { 1: '100' }, { USD: '1' });
  await saveBalances(page, '2025-02', { 1: '0' }, { USD: '1' });
  await nav(page, 'Dashboard');
  await expect(page.locator('.metric-secondary')).toContainText('-100.00%');
  const toggle = page.locator('#amountVisibility');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.money-text:visible')).toHaveCount(0);
  await expect(page.locator('.metric-secondary')).toContainText('-100.00%');
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.metric-value .money-text').first()).toBeVisible();
  await expect(page.locator('.money-axis:visible')).toHaveCount(5);
  await expect(page.locator('.chart-dot').first()).toHaveAttribute(
    'aria-label',
    /€100\.00/,
  );
  await page.locator('.chart-dot').first().focus();
  await expect(page.locator('#chartTooltip .money-text')).toBeVisible();
  await expect(page.locator('#chartTooltip')).toContainText('€100.00');
  await nav(page, 'Monthly balances');
  await expect(page.locator('[data-balance="1"]')).toHaveValue('0.00');
  await expect(page.locator('.balance-change')).toHaveText('-$100.00');
  await toggle.click();
  await page.locator('[data-action="copyPrevious"]').click();
  await expect(page.locator('[data-balance="1"]')).toHaveAttribute(
    'type',
    'password',
  );
  await expect(page.locator('[data-balance="1"]')).toHaveValue('100.00');
  await expect(page.locator('.balance-change .money-text')).toBeHidden();
  await toggle.click();
  await expect(page.locator('.balance-change')).toHaveText('$0.00');
  await page.locator('[data-action="saveMonth"]').click();
  await expect(page.locator('#toast')).toContainText('Month saved.');
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.metric-value .money-text').first()).toBeVisible();
});
