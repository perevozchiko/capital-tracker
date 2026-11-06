const { test, expect, open, nav, setMonth } = require('./helpers.cjs');

async function seed(page, app) {
  const put = async (path, data, method = 'PUT') => {
    const response = await page.request.fetch(app + '/api' + path, {
      method,
      data,
      headers: { 'X-Capital-Tracker': '1' },
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response;
  };
  const account = await (
    await put(
      '/accounts',
      { name: 'Bank', currency: 'USD', start_month: '2026-01' },
      'POST',
    )
  ).json();
  for (const [month, amount, rate] of [
    ['2026-10', '120000', '1.2'],
    ['2026-11', '143000', '1.3'],
  ]) {
    await put('/months/' + month, {
      balances: [{ account_id: account.id, amount_minor: amount }],
      rates: [{ currency: 'USD', rate }],
    });
  }
  for (const [month, eur, usd, rate] of [
    ['2026-10', '100000', '110000', '1.1'],
    ['2026-11', '150000', '180000', '1.2'],
  ]) {
    await put('/incomes/' + month, {
      entries: [
        {
          month,
          name: 'Salary',
          currency: 'EUR',
          amount_minor: eur,
          rate: '1',
        },
        { month, name: 'Bonus', currency: 'USD', amount_minor: usd, rate },
      ],
    });
  }
  await put('/expenses/2026-10', {
    entries: [
      {
        month: '2026-10',
        name: 'Holiday',
        currency: 'EUR',
        amount_minor: '50000',
        rate: '1',
      },
      {
        month: '2026-10',
        name: 'Zero USD',
        currency: 'USD',
        amount_minor: '0',
        rate: '1.1',
      },
    ],
  });
  await put('/recurring-expenses/2026-10', {
    entries: [
      {
        month: '2026-10',
        name: 'Rent',
        currency: 'RSD',
        amount_minor: '1172000',
        rate: '117.2',
      },
    ],
  });
  await page.reload();
  await setMonth(page, '2026-11');
}
const card = (page, section) =>
  page.locator(`.dashboard-flow[data-page="${section}"]`);
async function noOverflow(page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
}

for (const width of [320, 390, 768, 1440]) {
  test(`dashboard reviews, EUR changes and saved FX charts at ${width}px`, async ({
    page,
    app,
    isMobile,
  }, testInfo) => {
    test.skip(
      isMobile && width !== 390,
      'Other widths are covered by desktop browser projects.',
    );
    await page.setViewportSize({ width, height: 900 });
    await open(page, app);
    await seed(page, app);
    await expect(card(page, 'incomes').locator('.flow-total')).toHaveText(
      '€3,000.00',
    );
    await expect(card(page, 'incomes').locator('.flow-change')).toHaveText(
      /↑ \+€1,000.00.*\+50.00%/,
    );
    await expect(card(page, 'incomes').locator('.flow-change')).toHaveClass(
      /positive/,
    );
    await expect(card(page, 'expenses')).toContainText(
      'Not saved for this month',
    );
    await expect(card(page, 'recurringExpenses')).toContainText(
      'Not saved for this month',
    );
    await expect(page.locator('.month-review')).toContainText(
      '2 of 4 sections complete',
    );
    await expect(page.locator('.family-total-month .pill')).toHaveText(
      'Incomplete',
    );
    await noOverflow(page);

    await card(page, 'incomes').click();
    await expect(
      page.getByRole('heading', { name: 'Income', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.month-picker')).toHaveValue('2026-11');
    await nav(page, 'Dashboard');
    await card(page, 'expenses').click();
    await expect(page.locator('#expenseForm')).toBeVisible();
    await page
      .getByRole('button', { name: 'Save expense', exact: true })
      .click();
    await expect(page.locator('#toast')).toHaveText('Expense saved.');
    await nav(page, 'Dashboard');
    await expect(card(page, 'expenses').locator('.flow-total')).toHaveText(
      '€0.00',
    );
    await expect(card(page, 'expenses').locator('.flow-change')).toHaveText(
      /↓ -€500.00.*-100.00%/,
    );
    await expect(card(page, 'expenses').locator('.flow-change')).toHaveClass(
      /positive/,
    );
    await expect(page.locator('.month-review')).toContainText(
      '3 of 4 sections complete',
    );

    await card(page, 'recurringExpenses').click();
    await expect(
      page.getByText('Copied from 2026-10.', { exact: false }),
    ).toBeVisible();
    await page.locator('#recurringExpenseForm [type="submit"]').click();
    await expect(page.locator('#toast')).toHaveText('Recurring expense saved.');
    await nav(page, 'Dashboard');
    await expect(page.locator('.month-review')).toContainText(
      '4 of 4 sections complete',
    );
    await expect(page.locator('.month-review h2')).toHaveText(
      'Month completed',
    );
    await expect(page.locator('.family-total-month .pill')).toHaveText(
      'Complete',
    );
    await expect(
      card(page, 'recurringExpenses').locator('.flow-total'),
    ).toHaveText('€100.00');
    await expect(
      card(page, 'recurringExpenses').locator('.flow-change'),
    ).toContainText('0.00%');
    await page.locator('#amountVisibility').click();
    await expect(
      page.locator('.dashboard-flows .money-text:visible'),
    ).toHaveCount(6);
    await noOverflow(page);
    await expect(page.locator('#toast')).not.toHaveClass(/visible/);
    await page.screenshot({
      path: testInfo.outputPath('dashboard.png'),
      fullPage: true,
      animations: 'disabled',
    });

    await nav(page, 'FX Rates');
    for (const id of ['#fxPeriod']) {
      const bounds = await page.locator(id).boundingBox();
      expect(bounds.height).toBeGreaterThanOrEqual(44);
    }
    const usd = page.locator('[data-fx-currency="USD"]');
    const rsd = page.locator('[data-fx-currency="RSD"]');
    await expect(usd.locator('.fx-chart')).toBeVisible();
    await expect(rsd.locator('.fx-chart')).toBeVisible();
    await expect(usd.locator('.fx-quotes')).toContainText('1 EUR = 1.3 USD');
    await expect(usd.locator('.fx-quotes')).toContainText('1 EUR = 1.2 USD');
    await expect(rsd.locator('.fx-quotes')).toContainText('1 EUR = 117.2 RSD');
    await expect(page.locator('#fxSource, .fx-legend')).toHaveCount(0);
    await expect(usd.locator('.fx-series path')).toHaveCount(1);
    await expect(rsd.locator('.fx-series circle')).toHaveCount(2);
    const firstCard = await rsd.boundingBox();
    const secondCard = await usd.boundingBox();
    expect(secondCard.y).toBeGreaterThanOrEqual(firstCard.y + firstCard.height);
    expect(secondCard.width).toBeCloseTo(firstCard.width, 0);
    await usd.locator('[data-fx-quote]').first().click();
    await expect(page.locator('#chartTooltip')).toContainText('1 EUR =');
    const tooltipBounds = await page.locator('#chartTooltip').boundingBox();
    expect(tooltipBounds.x).toBeGreaterThanOrEqual(0);
    expect(tooltipBounds.x + tooltipBounds.width).toBeLessThanOrEqual(width);
    await expect(usd.locator('.fx-series circle')).toHaveCount(4);
    await page.locator('#fxPeriod').selectOption('6');
    await expect(usd.locator('.fx-series circle')).toHaveCount(4);
    await noOverflow(page);
    await expect(page.locator('#toast')).not.toHaveClass(/visible/);
    await page.screenshot({
      path: testInfo.outputPath('fx-rates.png'),
      fullPage: true,
      animations: 'disabled',
    });

    await page.reload();
    await setMonth(page, '2026-11');
    await expect(page.locator('.month-review')).toContainText(
      '4 of 4 sections complete',
    );
    await setMonth(page, '2026-12');
    await expect(page.locator('.month-review')).toContainText(
      '0 of 4 sections complete',
    );
    await expect(card(page, 'incomes').locator('.flow-total')).toHaveText('—');
  });
}

test('zero baselines and absent calendar months do not produce misleading percentages', async ({
  page,
  app,
}) => {
  await open(page, app);
  for (const [month, entries] of [
    ['2026-09', []],
    [
      '2026-10',
      [
        {
          month: '2026-10',
          name: 'Salary',
          currency: 'EUR',
          amount_minor: '10000',
          rate: '1',
        },
      ],
    ],
    ['2026-12', []],
  ]) {
    const response = await page.request.put(app + '/api/incomes/' + month, {
      data: { entries },
      headers: { 'X-Capital-Tracker': '1' },
    });
    expect(response.ok()).toBe(true);
  }
  await setMonth(page, '2026-10');
  await expect(card(page, 'incomes')).toContainText('+€100.00');
  await expect(card(page, 'incomes')).toContainText('percentage unavailable');
  await expect(card(page, 'incomes')).not.toContainText('Infinity');
  await setMonth(page, '2026-12');
  await expect(card(page, 'incomes')).toContainText(
    'Save both months to compare',
  );
  await expect(card(page, 'incomes').locator('.flow-total')).toHaveText(
    '€0.00',
  );
});
