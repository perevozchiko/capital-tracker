const { test, expect, open, nav, setMonth } = require('./helpers.cjs');

const group = (page, name) =>
  page.locator('[data-recurring-group]').filter({
    has: page.locator('.group-caption > strong', {
      hasText: new RegExp(`^${name}$`),
    }),
  });
const expense = (page, name) =>
  page.locator('[data-recurring-expense-row]').filter({
    has: page.locator('[data-recurring-expense-name]', {
      hasText: new RegExp(`^${name}$`),
    }),
  });
const members = (panel) => panel.locator('[data-recurring-expense-name]');
const total = (panel) => panel.locator('[data-recurring-group-total]');

async function createGroup(page, name) {
  await page.locator('[data-recurring-action="create"]').click();
  await page.getByLabel('Group name', { exact: true }).fill(name);
  await page.locator('#recurringExpenseGroupForm [type="submit"]').click();
  await expect(page.locator('#recurringExpenseGroupDialog')).not.toBeVisible();
}
async function add(page, name, amount, currency, target) {
  await page.locator('#recurringExpenseGroup').selectOption({ label: target });
  await page.locator('#recurringExpenseName').fill(name);
  await page.locator('#recurringExpenseAmount').fill(amount);
  await page.locator('#recurringExpenseCurrency').selectOption(currency);
  await page.locator('#addRecurringExpenseForm [type="submit"]').click();
}
async function save(page) {
  const old = await page.locator('#recurringExpenseForm').elementHandle();
  await page.locator('#recurringExpenseForm [type="submit"]').click();
  await expect.poll(() => old.evaluate((node) => node.isConnected)).toBe(false);
  await expect(page.locator('#toast')).toHaveText('Recurring expense saved.');
}
async function rowMenu(row) {
  await row.getByLabel('Recurring expense actions', { exact: true }).click();
}
async function groupMenu(panel, action) {
  await panel.getByLabel('Group actions', { exact: true }).click();
  await panel.locator(`[data-recurring-action="${action}"]`).click();
}
async function move(page, name, target) {
  const row = expense(page, name);
  await rowMenu(row);
  await row.locator('[data-recurring-move]').selectOption({ label: target });
  await row.locator('details').evaluate((node) => node.removeAttribute('open'));
}

for (const width of [320, 1280]) {
  test(`recurring groups show EUR totals and save monthly membership at ${width}px`, async ({
    page,
    app,
    restartApp,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await open(page, app);
    await nav(page, 'Recurring expenses');
    await setMonth(page, '2026-01');
    for (const name of ['Home', 'Services', 'Empty'])
      await createGroup(page, name);
    await add(page, 'Rent', '800', 'EUR', 'Home');
    await add(page, 'Phone', '110', 'USD', 'Services');
    await add(page, 'Cloud', '22', 'USD', 'Services');
    await add(page, 'Other', '10', 'EUR', 'Ungrouped');
    await expect(total(group(page, 'Home'))).toHaveText('€800.00');
    await expect(total(group(page, 'Services'))).toHaveText('—');
    await page.locator('[data-recurring-expense-rate="USD"]').fill('1.1');
    await expect(total(group(page, 'Services'))).toHaveText('€120.00');
    await expect(total(group(page, 'Empty'))).toHaveText('€0.00');
    await expect(page.locator('#recurringExpenseTotal')).toHaveText('€930.00');
    await expect(
      total(group(page, 'Home')).locator('.money-text'),
    ).toBeHidden();
    await page
      .getByRole('button', { name: 'Show amounts', exact: true })
      .click();
    await expect(
      total(group(page, 'Home')).locator('.money-text'),
    ).toBeVisible();

    await move(page, 'Cloud', 'Home');
    await expect(total(group(page, 'Home'))).toHaveText('€820.00');
    await expect(total(group(page, 'Services'))).toHaveText('€100.00');
    await rowMenu(expense(page, 'Cloud'));
    await expense(page, 'Cloud')
      .locator('[data-recurring-action="rowUp"]')
      .click();
    await expect(members(group(page, 'Home'))).toHaveText(['Cloud', 'Rent']);
    await groupMenu(group(page, 'Services'), 'groupUp');
    await expect(
      page.locator('.recurring-expense-group .group-caption > strong'),
    ).toHaveText(['Services', 'Home', 'Empty', 'Ungrouped']);
    await groupMenu(group(page, 'Empty'), 'rename');
    await page.getByLabel('Group name', { exact: true }).fill('Future');
    await page.locator('#recurringExpenseGroupForm [type="submit"]').click();
    await groupMenu(group(page, 'Services'), 'delete');
    await page.locator('#confirmCancel').click();
    await expect(group(page, 'Services')).toBeVisible();
    await groupMenu(group(page, 'Services'), 'delete');
    await page.locator('#confirmAccept').click();
    await expect(group(page, 'Services')).toHaveCount(0);
    await expect(members(group(page, 'Ungrouped'))).toHaveText([
      'Other',
      'Phone',
    ]);
    await expect(page.locator('#recurringExpenseTotal')).toHaveText('€930.00');
    await save(page);
    await setMonth(page, '2026-02');
    await expect(members(group(page, 'Home'))).toHaveText(['Cloud', 'Rent']);
    await move(page, 'Rent', 'Future');
    await save(page);
    await setMonth(page, '2026-01');
    await expect(members(group(page, 'Home'))).toHaveText(['Cloud', 'Rent']);
    await expect(members(group(page, 'Future'))).toHaveCount(0);
    await restartApp();
    await page.reload();
    await nav(page, 'Recurring expenses');
    await setMonth(page, '2026-03');
    await expect(members(group(page, 'Future'))).toHaveText(['Rent']);
    await expect(total(group(page, 'Home'))).toHaveText('€20.00');
    await expect(total(group(page, 'Future'))).toHaveText('€800.00');
    await page
      .getByRole('button', { name: 'Show amounts', exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      )
      .toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath('recurring-groups.png'),
      fullPage: true,
    });
  });
}

test('recurring groups and expenses drag, including empty and collapsed destinations', async ({
  page,
  app,
}) => {
  await page.setViewportSize({ width: 1440, height: 1800 });
  await open(page, app);
  await nav(page, 'Recurring expenses');
  await setMonth(page, '2026-01');
  for (const name of ['Alpha', 'Beta', 'Empty']) await createGroup(page, name);
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
    expense(page, 'A1'),
    group(page, 'Empty').locator('[data-recurring-group-header]'),
  );
  await expect(members(group(page, 'Empty'))).toHaveText(['A1']);
  await group(page, 'Beta')
    .getByLabel('Collapse or expand group', { exact: true })
    .click();
  await drag(
    expense(page, 'A2'),
    group(page, 'Beta').locator('[data-recurring-group-header]'),
  );
  await expect(total(group(page, 'Beta'))).toHaveText('€50.00');
  await group(page, 'Beta')
    .getByLabel('Collapse or expand group', { exact: true })
    .click();
  await expect(members(group(page, 'Beta'))).toHaveText(['B1', 'A2']);
  await drag(
    group(page, 'Empty').locator('[data-recurring-group-header]'),
    group(page, 'Alpha').locator('[data-recurring-group-header]'),
  );
  await expect(
    page.locator('.recurring-expense-group .group-caption > strong'),
  ).toHaveText(['Empty', 'Alpha', 'Beta', 'Ungrouped']);
  await save(page);
  await page.reload();
  await nav(page, 'Recurring expenses');
  await setMonth(page, '2026-01');
  await expect(
    page.locator('.recurring-expense-group .group-caption > strong'),
  ).toHaveText(['Empty', 'Alpha', 'Beta', 'Ungrouped']);
  await expect(members(group(page, 'Beta'))).toHaveText(['B1', 'A2']);
});

test('recurring group creation can be cancelled and duplicate names preserve edits', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Recurring expenses');
  await createGroup(page, 'Home');
  await page.locator('[data-recurring-action="create"]').click();
  await page.getByLabel('Group name', { exact: true }).fill('home');
  await page.locator('#recurringExpenseGroupForm [type="submit"]').click();
  await expect(page.getByLabel('Group name', { exact: true })).toHaveJSProperty(
    'validationMessage',
    'A group with that name already exists.',
  );
  await page.locator('[data-recurring-action="cancel"]').click();
  await expect(page.locator('[data-recurring-group]')).toHaveCount(2);
  await nav(page, 'Dashboard');
  await page.locator('#confirmCancel').click();
  await expect(group(page, 'Home')).toBeVisible();
});

test('recurring group export/import and read-only backups preserve membership', async ({
  page,
  app,
}, testInfo) => {
  const headers = { 'X-Capital-Tracker': '1' };
  const saved = await page.request.put(
    app + '/api/recurring-expenses/2026-01',
    {
      headers,
      data: {
        entries: [
          {
            month: '2026-01',
            name: 'Rent',
            currency: 'EUR',
            amount_minor: '80000',
            rate: '1',
          },
        ],
        groups: [
          { name: 'Home', entry_positions: [0] },
          { name: 'Empty', entry_positions: [] },
        ],
      },
    },
  );
  expect(saved.ok()).toBe(true);
  await open(page, app);
  await nav(page, 'Settings');
  const pendingDownload = page.waitForEvent('download');
  await page.locator('[data-action="exportJSON"]').click();
  const file = testInfo.outputPath('recurring-groups-backup.json');
  await (await pendingDownload).saveAs(file);
  await page.locator('[data-action="clearAllData"]').click();
  await page.locator('#clearDataPhrase').fill('DELETE');
  await page.locator('#clearDataAccept').click();
  await expect(page.getByText('Welcome to Capital Tracker')).toBeVisible();
  await nav(page, 'Settings');
  await page.locator('#jsonFileInput').setInputFiles(file);
  await page.locator('#confirmAccept').click();
  await expect(page.locator('#toast')).toContainText(
    'JSON data imported successfully',
  );
  await nav(page, 'Recurring expenses');
  await setMonth(page, '2026-01');
  await expect(members(group(page, 'Home'))).toHaveText(['Rent']);
  await expect(total(group(page, 'Home'))).toHaveText('€800.00');
  await expect(group(page, 'Empty')).toBeVisible();
  const backup = await page.request.post(app + '/api/backups', { headers });
  expect(backup.ok()).toBe(true);
  const { id } = await backup.json();
  await page.goto(app + '/?backup=' + encodeURIComponent(id));
  await expect(page.locator('#backupBanner')).toBeVisible();
  await nav(page, 'Recurring expenses');
  await setMonth(page, '2026-01');
  await expect(members(group(page, 'Home'))).toHaveText(['Rent']);
  await expect(page.locator('[data-recurring-action="create"]')).toBeDisabled();
  await expect(page.locator('[draggable="true"]')).toHaveCount(0);
  await expect(
    group(page, 'Home').locator('[data-recurring-action="delete"]'),
  ).toBeDisabled();
  await expect(
    expense(page, 'Rent').locator('[data-recurring-move]'),
  ).toBeDisabled();
  const toggle = group(page, 'Home').getByLabel('Collapse or expand group', {
    exact: true,
  });
  await toggle.click();
  await expect(members(group(page, 'Home'))).toBeHidden();
  await toggle.click();
  await expect(members(group(page, 'Home'))).toBeVisible();
});
