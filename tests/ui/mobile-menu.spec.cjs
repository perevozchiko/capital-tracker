const { test, expect, open, nav, createAccount } = require('./helpers.cjs');

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

async function swipe(page, points, selector = 'body', cancel = false) {
  await page.locator(selector).evaluate(
    (target, { points, cancel }) => {
      // WebKit exposes Touch but does not allow constructing it. Dispatch the
      // same event data in every engine; the CDP case below covers native input.
      const touch = ([x, y]) => ({
        identifier: 1,
        target,
        clientX: x,
        clientY: y,
      });
      const dispatch = (type, touches, changedTouches) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperties(event, {
          touches: { value: touches },
          changedTouches: { value: changedTouches },
        });
        target.dispatchEvent(event);
      };
      for (let index = 0; index < points.length; index++) {
        const item = touch(points[index]);
        dispatch(index ? 'touchmove' : 'touchstart', [item], [item]);
      }
      dispatch(cancel ? 'touchcancel' : 'touchend', [], [touch(points.at(-1))]);
    },
    { points, cancel },
  );
}

async function expectOpen(page, open) {
  await expect(page.locator('#mobileMenu')).toHaveAttribute(
    'aria-expanded',
    String(open),
  );
  await expect(page.locator('#menuBackdrop'))[
    open ? 'toBeVisible' : 'toBeHidden'
  ]();
  await expect
    .poll(() => page.locator('#sidebar').evaluate((el) => el.inert))
    .toBe(!open);
  await expect
    .poll(() => page.locator('.app-main').evaluate((el) => el.inert))
    .toBe(open);
}

test('rightward edge swipe opens navigation and leftward swipe closes it', async ({
  page,
  app,
}) => {
  await open(page, app);
  await expectOpen(page, false);
  await swipe(page, [
    [24, 300],
    [65, 302],
    [150, 305],
  ]);
  await expectOpen(page, true);
  await swipe(
    page,
    [
      [210, 300],
      [155, 302],
      [70, 304],
    ],
    '#sidebar',
  );
  await expectOpen(page, false);
  await expect(page.locator('#mobileMenu')).toBeFocused();
});

test('backdrop tap closes menu without activating the underlying page', async ({
  page,
  app,
}) => {
  await open(page, app);
  await page.locator('#mobileMenu').tap();
  await expectOpen(page, true);
  await page.locator('#menuBackdrop').tap({ position: { x: 350, y: 200 } });
  await expectOpen(page, false);
  await expect(page.locator('#pageHeading')).toHaveText('Dashboard');
});

test('backdrop swipe and Escape both close menu', async ({ page, app }) => {
  await open(page, app);
  await page.locator('#mobileMenu').tap();
  await swipe(
    page,
    [
      [380, 300],
      [340, 301],
      [290, 302],
    ],
    '#menuBackdrop',
  );
  await expectOpen(page, false);
  await page.keyboard.press('Enter');
  await expectOpen(page, true);
  await page.keyboard.press('Escape');
  await expectOpen(page, false);
});

test('short, vertical, reversed and cancelled gestures leave menu closed', async ({
  page,
  app,
}) => {
  await open(page, app);
  for (const points of [
    [
      [24, 300],
      [50, 301],
    ],
    [
      [24, 300],
      [30, 340],
      [160, 400],
    ],
    [
      [40, 300],
      [10, 301],
    ],
    [
      [100, 300],
      [250, 302],
    ],
  ]) {
    await swipe(page, points);
    await expectOpen(page, false);
  }
  await swipe(
    page,
    [
      [24, 300],
      [150, 302],
    ],
    'body',
    true,
  );
  await expectOpen(page, false);
});

test('swiping a navigation item does not select it', async ({ page, app }) => {
  await open(page, app);
  await page.locator('#mobileMenu').tap();
  await swipe(
    page,
    [
      [200, 300],
      [80, 302],
    ],
    '#navigation [data-page="accounts"]',
  );
  // Simulate the compatibility click some browsers emit after a touch sequence.
  await page
    .locator('#navigation [data-page="accounts"]')
    .evaluate((el) =>
      el.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }),
      ),
    );
  await expectOpen(page, false);
  await expect(page.locator('#pageHeading')).toHaveText('Dashboard');
});

test('native touch swipes open and close navigation', async ({
  page,
  app,
  browserName,
}, testInfo) => {
  test.skip(
    browserName !== 'chromium',
    'Native touch injection uses Chromium CDP.',
  );
  await open(page, app);
  const session = await page.context().newCDPSession(page);
  async function nativeSwipe(from, to) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: from, y: 300 }],
    });
    for (let step = 1; step <= 8; step++) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: from + ((to - from) * step) / 8, y: 300 }],
      });
    }
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
  }
  await nativeSwipe(24, 180);
  await expectOpen(page, true);
  await page.screenshot({
    path: testInfo.outputPath('mobile-menu-open.png'),
    animations: 'disabled',
  });
  await nativeSwipe(220, 60);
  await expectOpen(page, false);
  await expect(page.locator('#pageHeading')).toHaveText('Dashboard');
});

test('vertical menu scrolling keeps navigation open and keyboard focus stays inside', async ({
  page,
  app,
}) => {
  await open(page, app);
  await page.locator('#mobileMenu').tap();
  await swipe(
    page,
    [
      [150, 350],
      [145, 250],
    ],
    '#sidebar',
  );
  await expectOpen(page, true);
  await page.locator('#sidebar .nav-item').last().focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#sidebar .nav-item').first()).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#sidebar .nav-item').last()).toBeFocused();
});

test('form, table, chart and modal gestures do not open navigation', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Accounts');
  await page.locator('#accountName').fill('Savings');
  await swipe(
    page,
    [
      [24, 300],
      [150, 302],
    ],
    '#accountName',
  );
  await expectOpen(page, false);
  await expect(page.locator('#accountName')).toHaveValue('Savings');
  await createAccount(page, 'Savings');
  await page.locator('.account-actions-menu summary').click();
  await page.locator('[data-action="history"]').click();
  await swipe(
    page,
    [
      [24, 300],
      [150, 302],
    ],
    '.table-scroll',
  );
  await expectOpen(page, false);
  await page.locator('[data-action="toggleAmounts"]').evaluate((el) => {
    el.insertAdjacentHTML(
      'afterend',
      '<div class="chart-wrap" id="testChart"></div>',
    );
  });
  await swipe(
    page,
    [
      [24, 300],
      [150, 302],
    ],
    '#testChart',
  );
  await expectOpen(page, false);
  await nav(page, 'Accounts');
  await page.locator('[data-action="groupCreate"]').click();
  await expect(page.locator('#accountDialog')).toBeVisible();
  await swipe(
    page,
    [
      [24, 300],
      [150, 302],
    ],
    '#accountDialog',
  );
  await expectOpen(page, false);
  await expect(page.locator('#accountDialog')).toBeVisible();
});

test('navigation and resizing clean up the backdrop and background lock', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Accounts');
  await expectOpen(page, false);
  await page.locator('#accountName').fill('Editable after navigation');
  await page.locator('#mobileMenu').tap();
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect(page.locator('#menuBackdrop')).toBeHidden();
  await expect
    .poll(() => page.locator('.app-main').evaluate((el) => el.inert))
    .toBe(false);
  await expect
    .poll(() => page.locator('#sidebar').evaluate((el) => el.inert))
    .toBe(false);
  await swipe(page, [
    [24, 300],
    [150, 302],
  ]);
  await expect(page.locator('#sidebar')).not.toHaveClass(/show/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectOpen(page, false);
  const box = await page.locator('#mobileMenu').boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
});
