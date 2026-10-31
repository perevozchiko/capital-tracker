const { test, expect, open, nav, setMonth } = require('./helpers.cjs');

test('all screens work with narrow touch layouts and a short viewport', async ({
  page,
  app,
}) => {
  await page.setViewportSize({ width: 390, height: 480 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page, app);
  for (const screen of [
    'Accounts',
    'Monthly balances',
    'Income',
    'Major expenses',
    'Recurring expenses',
    'Settings',
    'Dashboard',
  ]) {
    await nav(page, screen);
    await expect(page.locator('#pageHeading')).toHaveText(screen);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
  }
  expect(errors).toEqual([]);
});

for (const [screen, prefix] of [
  ['Income', 'income'],
  ['Major expenses', 'expense'],
  ['Recurring expenses', 'recurringExpense'],
]) {
  test(`${screen} supports decimal input and persistence in this browser`, async ({
    page,
    app,
  }) => {
    await open(page, app);
    await nav(page, screen);
    await setMonth(page, '2026-10');
    await page.locator(`#${prefix}Name`).fill('Интернет & <rent>');
    await page.locator(`#${prefix}Amount`).fill('123,45');
    await page.locator(`#${prefix}Currency`).selectOption('EUR');
    await page
      .locator(`#add${prefix[0].toUpperCase() + prefix.slice(1)}Form button`)
      .click();
    const form = await page.locator(`#${prefix}Form`).elementHandle();
    await page.locator(`#${prefix}Form [type="submit"]`).click();
    await expect.poll(() => form.evaluate((el) => el.isConnected)).toBe(false);
    await expect(page.locator(`#${prefix}Total`)).toHaveText('€123.45');
    await page.reload();
    await nav(page, screen);
    await setMonth(page, '2026-10');
    await expect(page.locator(`#${prefix}Total`)).toHaveText('€123.45');
    await expect(page.locator('.income-list-main strong')).toHaveText(
      'Интернет & <rent>',
    );
  });
}

test('a delayed previous screen cannot overwrite navigation', async ({
  page,
  app,
}) => {
  await open(page, app);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let started;
  const pending = new Promise((resolve) => {
    started = resolve;
  });
  await page.route('**/api/incomes', async (route) => {
    started();
    await gate;
    await route.fulfill({ json: [] });
  });
  await page.locator('#mobileMenu').evaluate((el) => {
    if (getComputedStyle(el).display !== 'none') el.click();
  });
  await page.locator('[data-page="incomes"]').click();
  await pending;
  await nav(page, 'Settings');
  const response = page.waitForResponse((r) =>
    r.url().endsWith('/api/incomes'),
  );
  release();
  await (await response).finished();
  // Flush the delayed render without relying on timing sleeps.
  await page.evaluate(async () => {
    // The queued network response is processed before this next frame.
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await expect(page.locator('#pageHeading')).toHaveText('Settings');
  await expect(page.locator('#themeSelect')).toBeVisible();
  await expect(page.locator('#incomeForm')).toHaveCount(0);
});

test('group editor stays open until the updated list has loaded', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Accounts');
  await page.locator('[data-action="groupCreate"]').click();
  await page.locator('#editValue').fill('Savings');
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let started;
  const pending = new Promise((resolve) => {
    started = resolve;
  });
  await page.route('**/api/groups?*', async (route) => {
    started();
    await gate;
    await route.continue();
  });
  await page.locator('#confirmEdit').click();
  await pending;
  await expect(page.locator('#accountDialog')).toBeVisible();
  await expect(page.locator('#editAccountForm')).toHaveJSProperty(
    'inert',
    true,
  );
  release();
  await expect(page.locator('#accountDialog')).toBeHidden();
  await expect(
    page
      .locator('.account-group-head .group-caption > strong')
      .getByText('Savings', { exact: true }),
  ).toBeVisible();
});
