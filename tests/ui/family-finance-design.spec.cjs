const {
  test,
  expect,
  open,
  nav,
  createAccount,
  createGroup,
  saveBalances,
} = require('./helpers.cjs');

test('family dashboard uses actual saved balances, groups and privacy settings', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Accounts');
  await createGroup(page, 'Family savings');
  await page.locator('#accountGroup').selectOption({ label: 'Family savings' });
  await createAccount(page, 'Main bank');
  await nav(page, 'Monthly balances');
  await saveBalances(page, '2025-01', { 1: '1000.00' });
  await saveBalances(page, '2025-02', { 1: '1150.00' });
  await expect(page.locator('.family-month-progress-count')).toContainText(
    '1 / 1',
  );

  await nav(page, 'Dashboard');
  await expect(page.locator('.family-total')).toContainText('1,150.00');
  await expect(page.locator('.family-change')).toContainText('+€150.00');
  await expect(page.locator('.family-group-grid')).toContainText(
    'Family savings',
  );
  await expect(page.locator('.family-group-grid')).toContainText('1,150.00');
  await expect(page.locator('.family-history .history-svg')).toBeVisible();
  await expect(page.locator('.money-text:visible')).toHaveCount(0);

  await page.locator('#amountVisibility').click();
  await expect(page.locator('.family-group-value .money-text')).toBeVisible();
  await expect(page.locator('.family-past .money-text')).toHaveCount(2);
  await expect(page.locator('.family-next-step')).toContainText(
    'Month not yet complete',
  );
});

test('family mobile tabs navigate and More opens the existing drawer', async ({
  page,
  app,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, app);
  const tabs = page.locator('#mobileBottomNav');
  await expect(tabs).toBeVisible();
  await expect(tabs.locator('button')).toHaveText([
    'Home',
    'Balances',
    'Income',
    'Expenses',
    'More',
  ]);
  await expect(tabs.locator('[aria-current="page"]')).toHaveText('Home');
  await tabs.locator('[data-page="incomes"]').click();
  await expect(page.locator('#incomeForm')).toBeVisible();
  await tabs.locator('[data-page="expenses"]').click();
  await expect(page.locator('#expenseForm')).toBeVisible();
  await tabs.locator('[data-page="monthly"]').click();
  await expect(page.locator('.status-block')).toBeVisible();
  await expect(tabs.locator('[aria-current="page"]')).toHaveText('Balances');
  await tabs.locator('[data-action="mobileMore"]').click();
  await expect(page.locator('#sidebar')).toHaveClass(/show/);
  await page.locator('#menuBackdrop').click({ position: { x: 365, y: 200 } });
  await expect(page.locator('#sidebar')).not.toHaveClass(/show/);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    )
    .toBeLessThanOrEqual(1);
});
