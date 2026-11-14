const { test, expect, open, nav, setMonth } = require('./helpers.cjs');

const group = (page, name) =>
  page.locator('[data-expense-group]').filter({
    has: page.locator('.group-caption > strong', {
      hasText: new RegExp(`^${name}$`),
    }),
  });
const expense = (page, name) =>
  page.locator('[data-expense-row]').filter({
    has: page.locator('[data-expense-name]', {
      hasText: new RegExp(`^${name}$`),
    }),
  });
const members = (panel) => panel.locator('[data-expense-name]');
const total = (panel) => panel.locator('[data-expense-group-total]');
const captions = (page) =>
  page.locator('.expense-group .group-caption > strong');

async function createGroup(page, name) {
  await page.locator('[data-expense-action="create"]').click();
  await page.getByLabel('Group name', { exact: true }).fill(name);
  await page.locator('#expenseGroupForm [type="submit"]').click();
  await expect(page.locator('#expenseGroupDialog')).not.toBeVisible();
}
async function add(page, name, amount, currency, target) {
  await page.locator('#expenseGroup').selectOption({ label: target });
  await page.locator('#expenseName').fill(name);
  await page.locator('#expenseAmount').fill(amount);
  await page.locator('#expenseCurrency').selectOption(currency);
  await page.locator('#addExpenseForm [type="submit"]').click();
}
async function save(page) {
  const old = await page.locator('#expenseForm').elementHandle();
  await page.locator('#expenseForm [type="submit"]').click();
  await expect.poll(() => old.evaluate((node) => node.isConnected)).toBe(false);
  await expect(page.locator('#toast')).toHaveText('Expense saved.');
}
async function groupMenu(panel, action) {
  await panel.getByLabel('Group actions', { exact: true }).click();
  await panel.locator(`[data-expense-action="${action}"]`).click();
}
async function move(page, name, target) {
  const row = expense(page, name);
  await row.getByLabel('Expense actions', { exact: true }).click();
  await row.locator('[data-expense-move]').selectOption({ label: target });
  await row.locator('details').evaluate((node) => node.removeAttribute('open'));
}

for (const width of [320, 1280]) {
  test(`major expense groups show EUR subtotals and save per month at ${width}px`, async ({
    page,
    app,
    restartApp,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await open(page, app);
    await nav(page, 'Major expenses');
    await setMonth(page, '2026-01');
    for (const name of ['Home', 'Travel', 'Empty'])
      await createGroup(page, name);
    await add(page, 'Sofa', '800', 'EUR', 'Home');
    await add(page, 'Flights', '110', 'USD', 'Travel');
    await add(page, 'Hotel', '22', 'USD', 'Travel');
    await add(page, 'Gift', '10', 'EUR', 'Ungrouped');
    await expect(total(group(page, 'Home'))).toHaveText('€800.00');
    await expect(total(group(page, 'Travel'))).toHaveText('—');
    await page.locator('[data-expense-rate="USD"]').fill('1.1');
    await expect(total(group(page, 'Travel'))).toHaveText('€120.00');
    await expect(total(group(page, 'Empty'))).toHaveText('€0.00');
    await expect(total(group(page, 'Ungrouped'))).toHaveText('€10.00');
    await expect(page.locator('#expenseTotal')).toHaveText('€930.00');

    await move(page, 'Hotel', 'Home');
    await expect(total(group(page, 'Home'))).toHaveText('€820.00');
    await expect(total(group(page, 'Travel'))).toHaveText('€100.00');
    await expense(page, 'Hotel')
      .getByLabel('Expense actions', { exact: true })
      .click();
    await expense(page, 'Hotel')
      .locator('[data-expense-action="rowUp"]')
      .click();
    await expect(members(group(page, 'Home'))).toHaveText(['Hotel', 'Sofa']);
    await groupMenu(group(page, 'Travel'), 'groupUp');
    await expect(captions(page)).toHaveText([
      'Travel',
      'Home',
      'Empty',
      'Ungrouped',
    ]);
    await groupMenu(group(page, 'Empty'), 'rename');
    await page.getByLabel('Group name', { exact: true }).fill('Later');
    await page.locator('#expenseGroupForm [type="submit"]').click();
    await groupMenu(group(page, 'Travel'), 'delete');
    await page.locator('#confirmAccept').click();
    await expect(group(page, 'Travel')).toHaveCount(0);
    await expect(members(group(page, 'Ungrouped'))).toHaveText([
      'Gift',
      'Flights',
    ]);
    // Grouping never changes the month total.
    await expect(page.locator('#expenseTotal')).toHaveText('€930.00');
    await save(page);

    // Major expenses do not carry over: the next month starts without groups.
    await setMonth(page, '2026-02');
    await expect(captions(page)).toHaveText(['Ungrouped']);
    await expect(page.locator('[data-expense-row]')).toHaveCount(0);

    await restartApp();
    await page.reload();
    await nav(page, 'Major expenses');
    await setMonth(page, '2026-01');
    await expect(captions(page)).toHaveText(['Home', 'Later', 'Ungrouped']);
    await expect(members(group(page, 'Home'))).toHaveText(['Hotel', 'Sofa']);
    await expect(total(group(page, 'Home'))).toHaveText('€820.00');
    await expect(members(group(page, 'Later'))).toHaveCount(0);
    await expect(page.locator('#expenseTotal')).toHaveText('€930.00');
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      )
      .toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath('expense-groups.png'),
      fullPage: true,
    });
  });
}

test('major expenses and groups can be dragged and stay independent of recurring groups', async ({
  page,
  app,
}) => {
  await page.setViewportSize({ width: 1440, height: 1800 });
  await open(page, app);
  await nav(page, 'Major expenses');
  await setMonth(page, '2026-01');
  for (const name of ['Alpha', 'Beta']) await createGroup(page, name);
  await add(page, 'A1', '10', 'EUR', 'Alpha');
  await add(page, 'A2', '20', 'EUR', 'Alpha');
  await add(page, 'B1', '30', 'EUR', 'Beta');
  async function drag(source, target, after = false) {
    const box = await target.boundingBox();
    await source.dragTo(target, {
      sourcePosition: { x: 90, y: 20 },
      targetPosition: {
        x: 100,
        y: Math.max(2, box.height * (after ? 0.75 : 0.25)),
      },
    });
  }
  await drag(expense(page, 'A1'), expense(page, 'A2'), true);
  await expect(members(group(page, 'Alpha'))).toHaveText(['A2', 'A1']);
  await drag(
    expense(page, 'A2'),
    group(page, 'Beta').locator('[data-expense-group-header]'),
  );
  await expect(total(group(page, 'Beta'))).toHaveText('€50.00');
  await drag(
    group(page, 'Beta').locator('[data-expense-group-header]'),
    group(page, 'Alpha').locator('[data-expense-group-header]'),
  );
  await expect(captions(page)).toHaveText(['Beta', 'Alpha', 'Ungrouped']);
  await save(page);
  await page.reload();
  await nav(page, 'Major expenses');
  await setMonth(page, '2026-01');
  await expect(captions(page)).toHaveText(['Beta', 'Alpha', 'Ungrouped']);
  await expect(members(group(page, 'Beta'))).toHaveText(['B1', 'A2']);

  await nav(page, 'Recurring expenses');
  await expect(
    page.locator('.recurring-expense-group .group-caption > strong'),
  ).toHaveText(['Ungrouped']);
});

test('the mobile bottom bar opens major expenses directly', async ({
  page,
  app,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await open(page, app);
  const tab = page
    .locator('#mobileBottomNav')
    .getByRole('button', { name: 'Major expenses', exact: true });
  await expect(tab).toBeVisible();
  await expect(tab.locator('svg')).toBeVisible();
  await expect(tab).toHaveText('Expenses');
  await tab.click();
  await expect(page.locator('#expenseForm')).toBeVisible();
  await expect(tab).toHaveAttribute('aria-current', 'page');
  await expect(
    page.locator('#mobileBottomNav [data-action="mobileMore"]'),
  ).not.toHaveClass(/active/);
  const boxes = await page
    .locator('#mobileBottomNav button')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().right),
    );
  expect(Math.max(...boxes)).toBeLessThanOrEqual(320);
});
