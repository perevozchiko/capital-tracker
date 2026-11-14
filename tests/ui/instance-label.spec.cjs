const { test, expect, open, nav } = require('./helpers.cjs');

test('an ordinary installation shows no instance marker', async ({
  page,
  app,
}) => {
  await open(page, app);
  await expect(page.locator('#instanceLabel')).toBeHidden();
  await expect(page).toHaveTitle('Dashboard · Capital Tracker');
});

test.describe('labelled test instance', () => {
  test.use({ instanceLabel: 'DEV' });

  for (const width of [320, 1280]) {
    test(`the marker stays visible on every screen at ${width}px`, async ({
      page,
      app,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await open(page, app);
      const marker = page.locator('#instanceLabel');
      await expect(marker).toHaveText('DEV');
      await expect(page).toHaveTitle('[DEV] Dashboard · Capital Tracker');
      for (const screen of ['Monthly balances', 'Accounts', 'Settings']) {
        await nav(page, screen);
        await expect(marker).toBeInViewport();
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBeLessThanOrEqual(1);
    });
  }

  test.describe('with sign-in', () => {
    test.use({ authEnabled: true });

    test('the sign-in page shows the marker before logging in', async ({
      page,
      app,
    }) => {
      await page.goto(app);
      await expect(page.locator('#loginForm')).toBeVisible();
      await expect(page.locator('#instanceLabel')).toHaveText('DEV');
      await expect(page).toHaveTitle('[DEV] Sign in · Capital Tracker');
    });
  });
});
