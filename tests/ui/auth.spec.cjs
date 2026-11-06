const { test, expect, nav } = require('./helpers.cjs');
const { createHmac } = require('node:crypto');
test.use({ authEnabled: true });

function authenticatorCode() {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac('sha1', '12345678901234567890')
    .update(counter)
    .digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(
    6,
    '0',
  );
}

test.describe('two-factor device confirmation', () => {
  test.use({ totpSecret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' });

  async function enterPassword(page, app) {
    await page.goto(app);
    await page.locator('#loginUsername').fill('tester');
    await page.locator('#loginPassword').fill('browser test password');
    await page.locator('#loginForm button').click();
  }

  test('new devices need a code; trusted devices survive restart and sign-out', async ({
    page,
    context,
    browser,
    app,
    restartApp,
  }) => {
    await enterPassword(page, app);
    await expect(page.getByLabel('Authenticator code')).toBeFocused();
    await expect(page.locator('#trustDevice')).toBeChecked();
    expect((await page.request.get(app + '/api/data/export')).status()).toBe(
      401,
    );
    expect((await page.request.get(app + '/js/app.js')).status()).toBe(401);
    const code = authenticatorCode();
    await page
      .locator('#loginCode')
      .fill(code === '000000' ? '111111' : '000000');
    await page.locator('#loginForm button').click();
    await expect(page.locator('#loginError')).toContainText(
      'Invalid or already used code.',
    );
    await page.locator('#loginCode').fill(authenticatorCode());
    await page.locator('#loginForm button').click();
    await expect(page.locator('#logoutButton')).toBeVisible();
    const trust = (await context.cookies()).find(
      (cookie) => cookie.name === 'capital_tracker_trusted_device',
    );
    expect(trust.httpOnly).toBe(true);
    expect(trust.sameSite).toBe('Strict');
    await restartApp();
    await page.reload();
    await expect(page.locator('#logoutButton')).toBeVisible();
    await page.locator('#logoutButton').click();
    await expect(page.locator('#loginForm')).toBeVisible();
    expect((await page.request.get(app + '/api/data/export')).status()).toBe(
      401,
    );
    await enterPassword(page, app);
    await expect(page.locator('#logoutButton')).toBeVisible();
    await expect(page.locator('#loginCode')).toHaveCount(0);

    const other = await browser.newContext();
    try {
      const otherPage = await other.newPage();
      await enterPassword(otherPage, app);
      await expect(otherPage.getByLabel('Authenticator code')).toBeVisible();
      expect((await other.request.get(app + '/api/data/export')).status()).toBe(
        401,
      );
    } finally {
      await other.close();
    }

    // Losing only device trust also requires a code at the next password login.
    await context.clearCookies({ name: 'capital_tracker_trusted_device' });
    await page.locator('#logoutButton').click();
    await expect(page.locator('#loginForm')).toBeVisible();
    await enterPassword(page, app);
    await expect(page.getByLabel('Authenticator code')).toBeVisible();
  });

  test('shared devices can decline trust and the code form fits small screens', async ({
    page,
    context,
    app,
  }) => {
    await enterPassword(page, app);
    await expect(page.getByLabel('Authenticator code')).toBeVisible();
    await page.locator('#trustDevice').uncheck();
    await page.locator('#rememberDevice').uncheck();
    for (const width of [320, 390, 844, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator('#loginCode')).toBeInViewport();
      await expect(page.locator('#loginForm button')).toBeInViewport();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBeLessThanOrEqual(1);
    }
    await page.locator('#loginCode').fill(authenticatorCode());
    await page.locator('#loginForm button').click();
    await expect(page.locator('#logoutButton')).toBeVisible();
    expect(
      (await context.cookies()).find(
        (cookie) => cookie.name === 'capital_tracker_trusted_device',
      ),
    ).toBeUndefined();
    await page.locator('#logoutButton').click();
    await expect(page.locator('#loginForm')).toBeVisible();
    await enterPassword(page, app);
    await expect(page.getByLabel('Authenticator code')).toBeVisible();
  });
});

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
  await expect(
    page.getByLabel('Keep me signed in on this device'),
  ).toBeChecked();
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

for (const remember of [true, false]) {
  test(`login (remember=${remember}) survives server restart and reopening the browser, sign-out stays revoked`, async ({
    browser,
    app,
    restartApp,
  }) => {
    let context = await browser.newContext();
    try {
      let page = await context.newPage();
      await page.goto(app);
      await page
        .getByLabel('Keep me signed in on this device')
        .setChecked(remember);
      await page.locator('#loginUsername').fill('tester');
      await page.locator('#loginPassword').fill('browser test password');
      await page.locator('#loginForm button').click();
      await expect(page.locator('#logoutButton')).toBeVisible();
      const cookie = (await context.cookies()).find(
        (item) => item.name === 'capital_tracker_session',
      );
      expect(cookie.httpOnly).toBe(true);
      const lifetime = remember ? 180 : 30;
      expect(cookie.expires).toBeGreaterThan(
        Date.now() / 1000 + (lifetime - 1) * 86400,
      );
      expect(cookie.expires).toBeLessThanOrEqual(
        Date.now() / 1000 + lifetime * 86400 + 1,
      );

      await restartApp();
      await page.reload();
      await expect(page.locator('#logoutButton')).toBeVisible();
      await expect(page.locator('#loginForm')).toHaveCount(0);
      expect(
        (await context.request.get(app + '/api/data/export')).status(),
      ).toBe(200);

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
      expect(
        (await context.request.get(app + '/api/data/export')).status(),
      ).toBe(401);
    } finally {
      await context.close();
    }
  });
}

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
