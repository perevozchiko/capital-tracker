const { test, expect, open, nav } = require('./helpers.cjs');

async function fakeHost(context, app) {
  const actual = await (await fetch(app + '/api/meta')).json();
  let version = actual.version;
  let operation = null;
  let release = null;
  let checks = 0;
  let starts = 0;
  let offline = false;
  let checkError = false;
  const snapshot = () => ({ enabled: true, operation, release });
  await context.route('**/api/update/**', async (route) => {
    if (offline) return route.abort('failed');
    const action = new URL(route.request().url()).pathname.split('/').at(-1);
    if (action === 'check') {
      checks++;
      if (checkError)
        return route.fulfill({
          status: 502,
          json: { error: { code: 'update_check_failed' } },
        });
      release = { version: '0.4.0' };
    }
    if (action === 'start') {
      starts++;
      expect(route.request().headers()['x-capital-tracker']).toBe('1');
      const data = route.request().postDataJSON();
      expect(data.target_version).toBe('0.4.0');
      expect(data.request_id).toMatch(/^[a-f0-9-]{36}$/);
      operation = {
        id: 'test-op',
        status: 'running',
        stage: 'build',
        stages: ['build'],
        target_version: '0.4.0',
      };
    }
    await route.fulfill({ json: snapshot() });
  });
  await context.route('**/api/meta', async (route) => {
    if (offline) return route.abort('failed');
    await route.fulfill({ json: { ...actual, version } });
  });
  await context.route('**/api/settings', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ json: { ...data, version } });
  });
  return {
    counts: () => ({ checks, starts }),
    offline: (value) => {
      offline = value;
    },
    checkError: (value) => {
      checkError = value;
    },
    finish: (status) => {
      operation = {
        ...operation,
        status,
        stage: status === 'rolled_back' ? 'rollback' : 'health_check',
        stages: [
          'build',
          'test',
          'backup',
          'sqlite_check',
          'switch',
          'health_check',
          ...(status === 'rolled_back' ? ['rollback'] : []),
        ],
      };
      if (status === 'succeeded') version = '0.4.0';
    },
  };
}

test('without an agent updates are disabled and ordinary settings work', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Settings');
  await expect(page.locator('#appUpdates')).toContainText('not configured');
  await expect(
    page.getByRole('button', { name: 'Check for updates' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Update', exact: true }),
  ).toBeDisabled();
  await page.locator('#themeSelect').selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('check never starts an update; double clicks join; reconnect confirms version and clears stale PWA cache', async ({
  context,
  page,
  app,
}) => {
  const host = await fakeHost(context, app);
  await open(page, app);
  await nav(page, 'Settings');
  expect(host.counts()).toEqual({ checks: 0, starts: 0 });
  await page.getByRole('button', { name: 'Check for updates' }).click();
  await expect(page.locator('#appUpdates')).toContainText('v0.4.0');
  expect(host.counts()).toEqual({ checks: 1, starts: 0 });
  await page.locator('[data-action=startUpdate]').evaluate((el) => {
    el.click();
    el.click();
  });
  await expect(page.locator('#appUpdates')).toContainText('Building release');
  expect(host.counts().starts).toBe(1);
  await expect(
    page.getByRole('button', { name: 'Update', exact: true }),
  ).toBeDisabled();
  await page.evaluate(async () => {
    const cache = await caches.open('capital-tracker-static-old-test');
    await cache.put('/old-test', new Response('stale'));
    await caches.open('other-application');
  });
  host.offline(true);
  await expect(page.locator('#appUpdates')).toContainText('Reconnecting', {
    timeout: 15000,
  });
  host.finish('succeeded');
  host.offline(false);
  await expect
    .poll(async () =>
      page.evaluate(() => localStorage.getItem('capital-update-pending')),
    )
    .toBeNull();
  await nav(page, 'Settings');
  await expect(page.locator('#appUpdates')).toContainText(
    'Version v0.4.0 confirmed',
  );
  expect(host.counts().starts).toBe(1);
  expect(
    await page.evaluate(() => caches.has('capital-tracker-static-old-test')),
  ).toBe(false);
  expect(await page.evaluate(() => caches.has('other-application'))).toBe(true);
});

test('closing the tab and application restart resume host status without another start', async ({
  context,
  page,
  app,
  restartApp,
}) => {
  const host = await fakeHost(context, app);
  await open(page, app);
  await nav(page, 'Settings');
  await page.getByRole('button', { name: 'Check for updates' }).click();
  await page.getByRole('button', { name: 'Update', exact: true }).click();
  await expect(page.locator('#appUpdates')).toContainText('Building release');
  await page.close();
  await restartApp();
  const reopened = await context.newPage();
  await open(reopened, app);
  await nav(reopened, 'Settings');
  await expect(reopened.locator('#appUpdates')).toContainText(
    'Building release',
  );
  host.finish('rolled_back');
  await expect(reopened.locator('#appUpdates')).toContainText(
    'previous version and database were restored',
  );
  expect(host.counts().starts).toBe(1);
});

test('GitHub errors are visible; failed rollback blocks retries', async ({
  context,
  page,
  app,
}) => {
  const host = await fakeHost(context, app);
  await open(page, app);
  await nav(page, 'Settings');
  host.checkError(true);
  await page.getByRole('button', { name: 'Check for updates' }).click();
  await expect(page.locator('#appUpdates')).toContainText(
    'Could not check GitHub Releases',
  );
  expect(host.counts().starts).toBe(0);
  host.checkError(false);
  await page.getByRole('button', { name: 'Check for updates' }).click();
  await page.getByRole('button', { name: 'Update', exact: true }).click();
  host.finish('recovery_required');
  await expect(page.locator('#appUpdates')).toContainText(
    'could not be verified',
  );
  await expect(
    page.getByRole('button', { name: 'Update', exact: true }),
  ).toBeDisabled();
  expect(host.counts().starts).toBe(1);
});

test.describe('PWA update API', () => {
  test.use({ serviceWorkers: 'allow' });
  test('active worker removes old caches and fetches update status after app restart', async ({
    page,
    app,
    restartApp,
  }) => {
    await page.goto(app + '/api/meta');
    await page.evaluate(async () => {
      const cache = await caches.open('capital-tracker-static-stale');
      await cache.put('/old-module', new Response('stale'));
      await caches.open('other-application');
    });
    await open(page, app);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
      .toBe(true);
    await nav(page, 'Settings');
    await expect(page.locator('#appUpdates')).toContainText('not configured');
    expect(
      await page.evaluate(() => caches.has('capital-tracker-static-stale')),
    ).toBe(false);
    expect(await page.evaluate(() => caches.has('other-application'))).toBe(
      true,
    );
    await restartApp();
    const status = await page.evaluate(async () => {
      const response = await fetch('/api/update/status');
      return {
        data: await response.json(),
        cache: response.headers.get('cache-control'),
      };
    });
    expect(status.data.enabled).toBe(false);
    expect(status.cache).toBe('no-store');
    const cachedPaths = await page.evaluate(async () => {
      const keys = await caches.keys();
      const requests = (
        await Promise.all(
          keys.map(async (key) => (await caches.open(key)).keys()),
        )
      ).flat();
      return requests.map((request) => new URL(request.url).pathname);
    });
    expect(cachedPaths.some((path) => path.startsWith('/api/'))).toBe(false);
  });
});
