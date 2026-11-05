const { test, expect, open, nav, setMonth } = require('./helpers.cjs');

const headers = { 'X-Capital-Tracker': '1' };
const period = (page, name) => page.getByRole('button', { name, exact: true });

async function seedCapital(page, app, months) {
  const account = await page.request.post(app + '/api/accounts', {
    headers,
    data: { name: 'Chart savings', currency: 'EUR', start_month: '1900-01' },
  });
  expect(account.ok()).toBe(true);
  const { id } = await account.json();
  for (const [month, amount] of months) {
    const saved = await page.request.put(app + '/api/months/' + month, {
      headers,
      data: {
        balances:
          amount == null ? [] : [{ account_id: id, amount_minor: amount }],
        rates: [],
      },
    });
    expect(saved.ok()).toBe(true);
  }
}

async function applyRange(page, from, to) {
  await period(page, 'Custom').click();
  await page.getByLabel('From month', { exact: true }).fill(from);
  await page.getByLabel('To month', { exact: true }).fill(to);
  await period(page, 'Apply').click();
}

test('presets use inclusive calendar months and preserve data and tooltip indices', async ({
  page,
  app,
}) => {
  const months = [];
  for (let year = 2022; year <= 2025; year++) {
    for (let month = 1; month <= 12; month++) {
      const key = `${year}-${String(month).padStart(2, '0')}`;
      if (key === '2025-09') continue;
      months.push([
        key,
        key === '2025-06' ? null : String(year * 10000 + month),
      ]);
    }
  }
  await seedCapital(page, app, months);
  const before = await (
    await page.request.get(app + '/api/data/export')
  ).json();
  delete before.exported_at;
  await open(page, app);
  await expect(period(page, 'All time')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.chart-dot')).toHaveCount(46);
  const writes = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/') && request.method() !== 'GET')
      writes.push(request.method() + ' ' + request.url());
  });
  await period(page, '6 months').click();
  await expect(page.locator('.chart-dot')).toHaveCount(5);
  await expect(page.locator('.chart-range')).toHaveText('Jul 2025 – Dec 2025');
  await expect(page.locator('.chart-dot').first()).toHaveAttribute(
    'aria-label',
    'July 2025',
  );
  await page.getByRole('button', { name: 'Show amounts', exact: true }).click();
  await page.locator('.chart-dot').first().focus();
  await expect(page.locator('#chartTooltip')).toContainText(
    'July 2025 · €202,500.07',
  );
  await period(page, '1 year').click();
  await expect(page.locator('#chartTooltip')).toBeHidden();
  await expect(page.locator('.chart-dot')).toHaveCount(10);
  await expect(page.locator('.chart-range')).toHaveText('Jan 2025 – Dec 2025');
  await period(page, '3 years').click();
  await expect(page.locator('.chart-dot')).toHaveCount(34);
  await expect(page.locator('.chart-range')).toHaveText('Jan 2023 – Dec 2025');
  await setMonth(page, '2024-02');
  await expect(period(page, '3 years')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.chart-range')).toHaveText('Jan 2023 – Dec 2025');
  await period(page, 'All time').click();
  await expect(page.locator('.chart-dot')).toHaveCount(46);
  await page.getByRole('button', { name: 'Hide amounts', exact: true }).click();
  await period(page, '6 months').click();
  await expect(page.locator('.chart-dot').first()).toHaveAttribute(
    'aria-label',
    'July 2025',
  );
  await expect(page.locator('.money-axis:visible')).toHaveCount(0);
  expect(writes).toEqual([]);
  const after = await (await page.request.get(app + '/api/data/export')).json();
  delete after.exported_at;
  expect(after).toEqual(before);
});

test('charts connect across missing and incomplete months; custom ranges handle endpoints, single and empty months', async ({
  page,
  app,
}) => {
  await seedCapital(page, app, [
    ['2024-12', '-10000'],
    ['2025-01', '0'],
    ['2025-02', '12000'],
    ['2025-04', '15000'],
    ['2025-05', null],
    ['2025-06', '15000'],
    ['2025-07', '18000'],
  ]);
  await open(page, app);
  await expect(page.locator('.curve')).toHaveCount(1);
  await expect(page.locator('.chart-area')).toHaveCount(1);
  await expect(page.locator('.chart-dot')).toHaveCount(6);
  const connectedPoints = await page
    .locator('.chart-dot')
    .evaluateAll((dots) =>
      dots
        .map(
          (dot, index) =>
            `${index ? 'L' : 'M'}${dot.getAttribute('cx')},${dot.getAttribute('cy')}`,
        )
        .join(' '),
    );
  await expect(page.locator('.curve')).toHaveAttribute('d', connectedPoints);
  await applyRange(page, '2025-01', '2025-02');
  await expect(page.locator('.chart-dot')).toHaveCount(2);
  await expect(page.locator('.chart-range')).toHaveText('Jan 2025 – Feb 2025');
  await applyRange(page, '2025-02', '2025-01');
  await expect(page.getByLabel('To month', { exact: true })).toHaveJSProperty(
    'validationMessage',
    'The end month must be the same as or after the start month.',
  );
  await expect(page.locator('.chart-range')).toHaveText('Jan 2025 – Feb 2025');
  await page.getByLabel('To month', { exact: true }).fill('2025-02');
  await period(page, 'Apply').click();
  await expect(page.locator('.chart-dot')).toHaveCount(1);
  await expect(page.locator('.curve')).toHaveCount(0);
  await expect(page.locator('.chart-dot')).toHaveAttribute('cx', '459');
  await applyRange(page, '2025-03', '2025-05');
  await expect(page.locator('.chart-dot')).toHaveCount(1);
  await applyRange(page, '2025-05', '2025-05');
  await expect(page.locator('.chart-empty')).toContainText(
    'No complete months in this period',
  );
  await applyRange(page, '2028-01', '2028-12');
  await expect(page.locator('.chart-empty')).toBeVisible();
  await period(page, 'All time').click();
  await expect(page.locator('.chart-dot')).toHaveCount(6);
  await period(page, 'Custom').click();
  await expect(page.getByLabel('From month', { exact: true })).toHaveValue(
    '2028-01',
  );
  await expect(page.getByLabel('To month', { exact: true })).toHaveValue(
    '2028-12',
  );
});

test('decreases follow complete recorded values across gaps and range boundaries', async ({
  page,
  app,
}) => {
  await seedCapital(page, app, [
    ['2025-01', '10000'],
    ['2025-02', '9000'],
    ['2025-03', null],
    ['2025-05', '8000'],
    ['2025-06', '8000'],
    ['2025-07', '-1000'],
    ['2025-08', '-500'],
  ]);
  await open(page, app);
  const decreased = page.locator('.chart-dot-decreased');
  await expect(decreased).toHaveCount(3);
  await expect(page.locator('.history-svg path')).toHaveCount(2);
  await expect(decreased.first()).toHaveAttribute(
    'aria-label',
    'February 2025 · Lower than previous recorded month',
  );
  await decreased.first().focus();
  await expect(page.locator('#chartTooltip')).toContainText(
    'Lower than previous recorded month',
  );
  await expect(page.locator('#chartTooltip .money-text')).toBeHidden();
  await page.getByRole('button', { name: 'Show amounts', exact: true }).click();
  await expect(decreased.first()).toHaveAttribute(
    'aria-label',
    'February 2025: €90.00 · Lower than previous recorded month',
  );
  await applyRange(page, '2025-05', '2025-06');
  await expect(decreased).toHaveCount(1);
  await expect(decreased).toHaveAttribute('aria-label', /May 2025/);
  await applyRange(page, '2025-07', '2025-08');
  await expect(decreased).toHaveCount(1);
  await expect(decreased).toHaveAttribute('aria-label', /July 2025/);
});

for (const [screen, prefix, endpoint] of [
  ['Income', 'income', 'incomes'],
  ['Major expenses', 'expense', 'expenses'],
  ['Recurring expenses', 'recurringExpense', 'recurring-expenses'],
]) {
  test(`${screen} chart filtering preserves unsaved entries and editor month`, async ({
    page,
    app,
  }) => {
    for (const month of ['2024-12', '2025-07', '2025-12']) {
      const saved = await page.request.put(`${app}/api/${endpoint}/${month}`, {
        headers,
        data: {
          entries: [
            {
              month,
              name: 'Saved note',
              currency: 'EUR',
              amount_minor: month === '2024-12' ? '12345' : '10000',
              rate: '1',
            },
          ],
        },
      });
      expect(saved.ok()).toBe(true);
    }
    await open(page, app);
    await nav(page, screen);
    await setMonth(page, '2026-01');
    await page.locator(`#${prefix}Name`).fill('Unsaved note');
    await page.locator(`#${prefix}Amount`).fill('99.99');
    await page
      .locator(`#add${prefix[0].toUpperCase() + prefix.slice(1)}Form button`)
      .click();
    const editor = await page.locator(`#${prefix}Form`).elementHandle();
    const savedBefore = await (
      await page.request.get(`${app}/api/${endpoint}`)
    ).json();
    await period(page, '6 months').click();
    await expect(page.locator('.chart-dot')).toHaveCount(2);
    await expect(page.locator('.chart-dot-decreased')).toHaveCount(1);
    await expect(page.locator('.chart-dot-decreased')).toHaveAttribute(
      'aria-label',
      'July 2025 · Lower than previous recorded month',
    );
    await expect(page.locator('.curve')).toHaveCount(1);
    await expect(page.locator('.chart-area')).toHaveCount(1);
    await applyRange(page, '2024-12', '2024-12');
    await expect(page.locator('.chart-dot')).toHaveCount(1);
    await expect(page.locator('.chart-dot-decreased')).toHaveCount(0);
    await expect(page.locator(`#${prefix}Form`)).toContainText('Unsaved note');
    await expect(page.locator('.month-picker')).toHaveValue('2026-01');
    expect(await editor.evaluate((node) => node.isConnected)).toBe(true);
    await expect(page.locator('#confirmDialog')).not.toBeVisible();
    expect(
      await (await page.request.get(`${app}/api/${endpoint}`)).json(),
    ).toEqual(savedBefore);
    await nav(page, 'Settings');
    await expect(page.locator('#confirmDialog')).toBeVisible();
    await page.locator('#confirmCancel').click();
    await expect(page.locator(`#${prefix}Form`)).toContainText('Unsaved note');
  });
}

for (const width of [320, 1280]) {
  test(`chart controls fit dark and light layouts at ${width}px`, async ({
    page,
    app,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await seedCapital(page, app, [
      ['2025-01', '100000'],
      ['2025-02', '105000'],
      ['2025-03', '103000'],
      ['2025-04', '108000'],
      ['2025-05', '112000'],
      ['2025-06', '120000'],
    ]);
    await open(page, app);
    await page
      .getByRole('button', { name: 'Show amounts', exact: true })
      .click();
    for (const theme of ['dark', 'light']) {
      await nav(page, 'Settings');
      await page.locator('#themeSelect').selectOption(theme);
      await nav(page, 'Dashboard');
      await period(page, '6 months').click();
      await expect(page.locator('.history-svg')).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`chart-${theme}.png`),
        fullPage: true,
      });
      await applyRange(page, '2025-02', '2025-05');
      const controls = page.locator(
        '.history-chart button, .history-chart input',
      );
      for (const control of await controls.all()) {
        const box = await control.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  });
}
