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

// Separate events let assertions inspect the drawer while the finger is down.
async function menuTouch(page, type, x, time, fingers = 1) {
  return page.evaluate(
    ({ type, x, time, fingers }) => {
      const target = document.body;
      const touch = { identifier: 1, target, clientX: x, clientY: 300 };
      const event = new Event(type, { bubbles: true, cancelable: true });
      const ended = type === 'touchend' || type === 'touchcancel';
      Object.defineProperties(event, {
        touches: {
          value: ended
            ? []
            : Array.from({ length: fingers }, (_, index) => ({
                ...touch,
                identifier: index + 1,
              })),
        },
        changedTouches: { value: [touch] },
        timeStamp: { value: time },
      });
      target.dispatchEvent(event);
      const sidebar = document.querySelector('#sidebar');
      const backdrop = document.querySelector('#menuBackdrop');
      return {
        left: sidebar.getBoundingClientRect().left,
        width: sidebar.offsetWidth,
        opacity: Number(getComputedStyle(backdrop).opacity),
        transition: getComputedStyle(sidebar).transitionDuration,
      };
    },
    { type, x, time, fingers },
  );
}

test('drawer and shading follow the finger in both directions before release', async ({
  page,
  app,
}) => {
  await open(page, app);
  await menuTouch(page, 'touchstart', 24, 0);
  const first = await menuTouch(page, 'touchmove', 104, 100);
  expect(first.left).toBeLessThan(0);
  expect(first.left + first.width).toBeGreaterThan(0);
  expect(first.opacity).toBeGreaterThan(0);
  expect(first.opacity).toBeLessThan(1);
  expect(first.transition).toBe('0s');
  const further = await menuTouch(page, 'touchmove', 148, 200);
  expect(further.left - first.left).toBeCloseTo(44, 1);
  expect(further.opacity).toBeGreaterThan(first.opacity);
  const reversed = await menuTouch(page, 'touchmove', 126, 300);
  expect(reversed.left - further.left).toBeCloseTo(-22, 1);
  expect(reversed.opacity).toBeLessThan(further.opacity);
  await menuTouch(page, 'touchmove', 204, 1000);
  const settling = await menuTouch(page, 'touchend', 204, 1200);
  expect(settling.left).toBeLessThan(0);
  expect(settling.transition).not.toBe('0s');
  await expectOpen(page, true);
  // Finish settling before beginning a new slow drag from the open position.
  await page.locator('#sidebar').evaluate((el) => {
    for (const animation of el.getAnimations()) animation.finish();
  });
  await menuTouch(page, 'touchstart', 210, 2000);
  const closing = await menuTouch(page, 'touchmove', 130, 2400);
  expect(closing.left).toBeCloseTo(-80, 1);
  expect(closing.opacity).toBeGreaterThan(0);
  expect(closing.opacity).toBeLessThan(1);
  await menuTouch(page, 'touchmove', 40, 3000);
  await menuTouch(page, 'touchend', 40, 3200);
  await expectOpen(page, false);
});

test('slow partial drags snap back and a quick short flick can open the drawer', async ({
  page,
  app,
}) => {
  await open(page, app);
  await menuTouch(page, 'touchstart', 24, 0);
  await menuTouch(page, 'touchmove', 104, 1000);
  await menuTouch(page, 'touchend', 104, 1300);
  await expectOpen(page, false);
  await expect(page.locator('.app-main')).not.toHaveAttribute('inert');
  await menuTouch(page, 'touchstart', 24, 2000);
  await menuTouch(page, 'touchmove', 104, 2050);
  await menuTouch(page, 'touchend', 104, 2060);
  await expectOpen(page, true);
});

test('cancel, multiple fingers and resizing restore a partially dragged menu', async ({
  page,
  app,
}) => {
  await open(page, app);
  await menuTouch(page, 'touchstart', 24, 0);
  await menuTouch(page, 'touchmove', 170, 100);
  await menuTouch(page, 'touchcancel', 170, 200);
  await expectOpen(page, false);
  await menuTouch(page, 'touchstart', 24, 1000);
  await menuTouch(page, 'touchmove', 170, 1100);
  await menuTouch(page, 'touchmove', 180, 1200, 2);
  await expectOpen(page, false);
  await menuTouch(page, 'touchstart', 24, 2000);
  await menuTouch(page, 'touchmove', 170, 2100);
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect(page.locator('#menuBackdrop')).toBeHidden();
  await expect(page.locator('body')).not.toHaveClass(/menu-open/);
  await expect(page.locator('.app-main')).not.toHaveAttribute('inert');
  await expect(page.locator('#sidebar')).not.toHaveAttribute('inert');
  await expect(page.locator('#sidebar')).not.toHaveClass(/dragging/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectOpen(page, false);
});

test('button opening and backdrop closing animate the panel and the shade', async ({
  page,
  app,
}) => {
  await open(page, app);
  for (const opening of [true, false]) {
    const middle = await page.evaluate((opening) => {
      const sidebar = document.querySelector('#sidebar');
      const backdrop = document.querySelector('#menuBackdrop');
      // Pause actual CSS transitions partway through to inspect both phases.
      (opening ? document.querySelector('#mobileMenu') : backdrop).click();
      const slide = sidebar
        .getAnimations()
        .find((animation) => animation.transitionProperty === 'transform');
      const fade = backdrop
        .getAnimations()
        .find((animation) => animation.transitionProperty === 'opacity');
      if (!slide || !fade) throw new Error('Menu transitions are missing');
      for (const animation of [slide, fade]) {
        animation.pause();
        animation.currentTime = animation.effect.getTiming().duration / 4;
      }
      return {
        left: sidebar.getBoundingClientRect().left,
        width: sidebar.offsetWidth,
        opacity: Number(getComputedStyle(backdrop).opacity),
        visible: getComputedStyle(backdrop).visibility,
      };
    }, opening);
    expect(middle.left).toBeLessThan(0);
    expect(middle.left).toBeGreaterThan(-middle.width - 32);
    expect(middle.opacity).toBeGreaterThan(0);
    expect(middle.opacity).toBeLessThan(1);
    expect(middle.visible).toBe('visible');
    await page.evaluate(() => {
      for (const selector of ['#sidebar', '#menuBackdrop'])
        for (const animation of document
          .querySelector(selector)
          .getAnimations())
          animation.finish();
    });
    await expectOpen(page, opening);
  }
});

test('reduced motion skips settling animations and keeps direct finger movement', async ({
  page,
  app,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, app);
  await page.locator('#mobileMenu').tap();
  await expectOpen(page, true);
  const transitions = await page.evaluate(() =>
    ['#sidebar', '#menuBackdrop'].map(
      (selector) =>
        getComputedStyle(document.querySelector(selector)).transitionDuration,
    ),
  );
  expect(transitions).toEqual(['0s', '0s']);
  await menuTouch(page, 'touchstart', 210, 0);
  const dragged = await menuTouch(page, 'touchmove', 130, 100);
  expect(dragged.left).toBeCloseTo(-80, 1);
  await menuTouch(page, 'touchcancel', 130, 200);
  await expectOpen(page, true);
  await page.keyboard.press('Escape');
  await expectOpen(page, false);
});

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
      if (step === 4) {
        const position = await page.locator('#sidebar').boundingBox();
        expect(position.x).toBeLessThan(0);
        expect(position.x + position.width).toBeGreaterThan(0);
      }
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
