const { test, expect, open, nav, setMonth } = require('./helpers.cjs');

for (const width of [320, 1280]) {
  test(`income notes convert, persist, edit and delete at ${width}px`, async ({
    page,
    app,
    restartApp,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, app);
    await nav(page, 'Income');
    await expect(
      page.getByText('Save monthly income to see how it changes in EUR.'),
    ).toBeVisible();
    await setMonth(page, '2026-01');
    await page.locator('#income-EUR').fill('100');
    await page.locator('#income-USD').fill('110,00');
    await page.locator('#income-rate-USD').fill('1,1');
    await page
      .getByRole('button', { name: 'Save income', exact: true })
      .click();
    await expect(page.locator('#incomeTotal')).toHaveText('€200.00');
    expect(await (await page.request.get(app + '/api/months')).json()).toEqual(
      [],
    );
    await setMonth(page, '2026-02');
    await expect(page.locator('#income-EUR')).toHaveValue('');
    await page.locator('#income-EUR').fill('300');
    await page
      .getByRole('button', { name: 'Save income', exact: true })
      .click();
    await expect(page.locator('[data-chart-source="income"]')).toHaveCount(2);
    await expect(page.locator('.curve')).toHaveCount(1);
    await page.locator('[data-chart-source="income"]').last().focus();
    await expect(page.locator('#chartTooltip')).toContainText('€300.00');
    await page.locator('#amountVisibility').click();
    await expect(page.locator('#income-EUR')).toHaveAttribute(
      'type',
      'password',
    );
    await expect(
      page.locator('[data-chart-source="income"]').last(),
    ).toHaveAttribute('aria-label', 'February 2026');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await restartApp();
    await page.reload();
    await nav(page, 'Income');
    await setMonth(page, '2026-01');
    await expect(page.locator('#income-rate-USD')).toHaveValue('1.1');
    await page.locator('#income-rate-USD').fill('2.2');
    await page
      .getByRole('button', { name: 'Save income', exact: true })
      .click();
    await expect(page.locator('#incomeTotal')).toHaveText('€150.00');
    await page.locator('[data-action="deleteIncome"]').click();
    await page.locator('#confirmCancel').click();
    await expect(page.locator('#income-USD')).toHaveValue('110.00');
    await page.locator('[data-action="deleteIncome"]').click();
    await page.locator('#confirmAccept').click();
    await expect(page.locator('#income-USD')).toHaveValue('');
    await expect(page.locator('[data-chart-source="income"]')).toHaveCount(1);
  });
}

test('income validates amounts and rates, protects unsaved edits and loads rates on request', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Income');
  await setMonth(page, '2026-01');
  await page.locator('#income-USD').fill('-1');
  await page.getByRole('button', { name: 'Save income', exact: true }).click();
  await expect(page.locator('#income-USD')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await page.locator('#income-USD').fill('110');
  await page.getByRole('button', { name: 'Save income', exact: true }).click();
  await expect(page.locator('#income-rate-USD')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await nav(page, 'Dashboard');
  await page.locator('#confirmCancel').click();
  await expect(page.locator('#income-USD')).toHaveValue('110');
  await page.route('**/api/exchange-rates?*', (route) =>
    route.fulfill({ json: { date: '2026-10-30', rates: { USD: '1.1' } } }),
  );
  await page.locator('[data-action="loadIncomeRates"]').click();
  await expect(page.locator('#income-rate-USD')).toHaveValue('1.1');
  await page.getByRole('button', { name: 'Save income', exact: true }).click();
  await expect(page.locator('#incomeTotal')).toHaveText('€100.00');
  await page.locator('#income-EUR').fill('0');
  await nav(page, 'Dashboard');
  await page.locator('#confirmAccept').click();
  await nav(page, 'Income');
  await expect(page.locator('#income-EUR')).toHaveValue('');
});

test('income waits for rates, preserves concurrent edits and retries a failed save', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Income');
  await setMonth(page, '2026-01');
  await page.locator('#income-USD').fill('110');
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/exchange-rates?*', async (route) => {
    await gate;
    await route.fulfill({
      json: { date: '2026-10-30', rates: { USD: '1.1' } },
    });
  });
  await page.locator('[data-action="loadIncomeRates"]').click();
  const save = page.getByRole('button', { name: 'Save income', exact: true });
  await expect(save).toBeDisabled();
  await page.locator('#income-rate-USD').fill('2.2');
  release();
  await expect(save).toBeEnabled();
  await expect(page.locator('#income-rate-USD')).toHaveValue('2.2');
  await page.route('**/api/incomes/2026-01', (route) =>
    route.fulfill({ status: 500, json: { error: { code: 'internal_error' } } }),
  );
  await save.click();
  await expect(page.locator('#toast')).toContainText(
    'Database or server error.',
  );
  await expect(save).toBeEnabled();
  await expect(page.locator('#income-USD')).toHaveValue('110');
  await expect(page.locator('#income-rate-USD')).toHaveValue('2.2');
  await page.unroute('**/api/incomes/2026-01');
  await save.click();
  await expect(page.locator('#incomeTotal')).toHaveText('€50.00');
});
