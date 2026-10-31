const { test, expect, nav } = require('./helpers.cjs');
test.use({ authEnabled: true });

test('login protects financial data, survives reload and sign-out revokes access', async ({
  page,
  app,
}) => {
  const response = await page.goto(app);
  const html = await response.text();
  expect(html).toContain('id="loginForm"');
  expect(html).not.toContain('id="sidebar"');
  expect(html).not.toContain('/js/app.js');
  await expect(page.locator('#loginForm')).toBeVisible();
  await expect(page.locator('#sidebar')).toHaveCount(0);
  for (const asset of ['/js/app.js', '/css/app.css', '/manifest.webmanifest'])
    expect((await page.request.get(app + asset)).status()).toBe(401);
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
  const remembered = await page.request.get(app);
  expect(await remembered.text()).not.toContain('id="loginForm"');
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

test('sign-in is visible without JavaScript and stays usable on small screens', async ({
  browser,
  app,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(app);
    await expect(page.locator('#loginForm')).toBeVisible();
    await expect(page.locator('#sidebar')).toHaveCount(0);
    await expect(page.locator('#pageHeading')).toHaveCount(0);
    for (const width of [320, 390, 844, 1280]) {
      await page.setViewportSize({ width, height: 480 });
      await expect(page.locator('#loginForm button')).toBeInViewport();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBeLessThanOrEqual(1);
    }
  } finally {
    await context.close();
  }
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

test.describe('authentication with service workers enabled', () => {
  test.use({ serviceWorkers: 'allow' });

  test('old application caches are removed and cannot restore the site after sign-out', async ({
    page,
    context,
    app,
  }) => {
    // Seed the cache before loading a page that registers the new worker.
    await page.goto(app + '/api/meta');
    await page.evaluate(async () => {
      const old = await caches.open('capital-tracker-static-legacy');
      await old.put(
        '/',
        new Response('<main id="old-app">Old application</main>'),
      );
      await caches.open('unrelated-cache');
    });
    await page.goto(app);
    await expect(page.locator('#loginForm')).toBeVisible();
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await expect
      .poll(() => page.evaluate(() => caches.keys()))
      .not.toContain('capital-tracker-static-legacy');
    expect(await page.evaluate(() => caches.keys())).toContain(
      'unrelated-cache',
    );

    await page.locator('#loginUsername').fill('tester');
    await page.locator('#loginPassword').fill('browser test password');
    await page.locator('#loginForm button').click();
    await expect(page.locator('#logoutButton')).toBeVisible();
    await page.locator('#logoutButton').click();
    await expect(page.locator('#loginForm')).toBeVisible();
    await expect(page.locator('#sidebar')).toHaveCount(0);

    await context.setOffline(true);
    try {
      const restored = await page.evaluate(async () => {
        try {
          await fetch('/');
          return true;
        } catch {
          return false;
        }
      });
      expect(restored).toBe(false);
    } finally {
      await context.setOffline(false);
    }
  });
});
