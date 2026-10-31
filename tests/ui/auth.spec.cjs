const { test, expect, nav } = require('./helpers.cjs');
test.use({ authEnabled: true });

test('login protects financial data, survives reload and sign-out revokes access', async ({
  page,
  app,
}) => {
  await page.goto(app);
  await expect(page.locator('#loginForm')).toBeVisible();
  expect((await page.request.get(app + '/api/data/export')).status()).toBe(401);
  await page.locator('#loginUsername').fill('tester');
  await page.locator('#loginPassword').fill('wrong');
  await page.locator('#loginForm button').click();
  await expect(page.locator('#loginError')).toHaveText(
    'Incorrect username or password.',
  );
  await page.locator('#loginPassword').fill('browser test password');
  await page.locator('#loginForm button').click();
  await expect(page.locator('#logoutButton')).toBeVisible();
  await expect(page.locator('#loginForm')).toHaveCount(0);
  expect((await page.request.get(app + '/api/data/export')).status()).toBe(200);
  await page.reload();
  await expect(page.locator('#logoutButton')).toBeVisible();
  for (const width of [320, 844, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const screen of [
      'Accounts',
      'Monthly balances',
      'Income',
      'Major expenses',
      'Recurring expenses',
      'Settings',
    ]) {
      await nav(page, screen);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBeLessThanOrEqual(1);
      await expect(page.locator('#logoutButton')).toBeVisible();
    }
  }
  await page.locator('#logoutButton').click();
  await expect(page.locator('#loginForm')).toBeVisible();
  expect((await page.request.get(app + '/api/data/export')).status()).toBe(401);
});

test('login survives server restart and reopening the browser, sign-out stays revoked', async ({
  browser,
  app,
  restartApp,
}) => {
  let context = await browser.newContext();
  try {
    let page = await context.newPage();
    await page.goto(app);
    await page.locator('#loginUsername').fill('tester');
    await page.locator('#loginPassword').fill('browser test password');
    await page.locator('#loginForm button').click();
    await expect(page.locator('#logoutButton')).toBeVisible();
    const cookie = (await context.cookies()).find(
      (item) => item.name === 'capital_tracker_session',
    );
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.expires).toBeGreaterThan(Date.now() / 1000 + 390 * 86400);

    await restartApp();
    await page.reload();
    await expect(page.locator('#logoutButton')).toBeVisible();
    await expect(page.locator('#loginForm')).toHaveCount(0);
    expect((await context.request.get(app + '/api/data/export')).status()).toBe(
      200,
    );

    // Reopen with only cookies that a normal browser persists to disk.
    const saved = await context.storageState();
    saved.cookies = saved.cookies.filter((item) => item.expires > 0);
    await context.close();
    context = await browser.newContext({ storageState: saved });
    page = await context.newPage();
    await page.goto(app);
    await expect(page.locator('#logoutButton')).toBeVisible();
    await expect(page.locator('#loginForm')).toHaveCount(0);
    await page.locator('#logoutButton').click();
    await expect(page.locator('#loginForm')).toBeVisible();

    await restartApp();
    // Replaying the previously valid cookie must fail after sign-out/restart.
    await context.addCookies(saved.cookies);
    await page.reload();
    await expect(page.locator('#loginForm')).toBeVisible();
    expect((await context.request.get(app + '/api/data/export')).status()).toBe(
      401,
    );
  } finally {
    await context.close();
  }
});
