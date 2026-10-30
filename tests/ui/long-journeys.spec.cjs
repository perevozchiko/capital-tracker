const { readFile } = require('node:fs/promises');
const {
  test,
  expect,
  open,
  nav,
  createAccount,
  createGroup,
  accountGroup,
  row,
  expectMembers,
  drag,
  saveBalances,
  setMonth,
  action,
  editDialog,
} = require('./helpers.cjs');

test('long journey: organize, drag, collapse, restart, export, clear and restore multiple financial months', async ({
  page,
  app,
  restartApp,
}, testInfo) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1440, height: 1800 });
  await open(page, app);
  await nav(page, 'Accounts');
  for (const name of ['Cash', 'Investments', 'Empty'])
    await createGroup(page, name);
  for (const [name, group] of [
    ['Bank', 'Cash'],
    ['Wallet', 'Cash'],
    ['Broker', 'Investments'],
  ]) {
    await page.locator('#accountGroup').selectOption({ label: group });
    await createAccount(page, name);
  }
  await nav(page, 'Monthly balances');
  await saveBalances(page, '2025-12', { 1: '100', 2: '20', 3: '500' });
  await saveBalances(page, '2026-01', { 1: '150', 2: '30', 3: '600' });
  await nav(page, 'Dashboard');
  await expect(page.locator('.metric').first()).toContainText('€780.00');
  await expect(page.locator('.metric').nth(1)).toContainText(
    '+€160.00 (+25.81%)',
  );
  await nav(page, 'Accounts');
  await drag(page, row(page, 'Wallet'), row(page, 'Bank'), false);
  await expectMembers(page, 'Cash', ['Wallet', 'Bank']);
  await drag(
    page,
    row(page, 'Bank'),
    accountGroup(page, 'Investments').locator('.account-group-head'),
  );
  await expectMembers(page, 'Investments', ['Broker', 'Bank']);
  await drag(
    page,
    accountGroup(page, 'Empty').locator('.account-group-head'),
    accountGroup(page, 'Cash').locator('.account-group-head'),
    false,
    '/api/groups/reorder',
  );
  await page.getByRole('button', { name: 'Collapse all', exact: true }).click();
  await nav(page, 'Monthly balances');
  await expect(page.locator('.account-group:not(.is-collapsed)')).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Expand all', exact: true }).click();
  await expect(
    page.locator('.monthly-group .group-caption > strong'),
  ).toHaveText(['Empty', 'Cash', 'Investments', 'Ungrouped', 'Archive']);
  await expect(
    accountGroup(page, 'Investments').locator('[data-balance]'),
  ).toHaveCount(2);
  await restartApp();
  await page.reload();
  await nav(page, 'Accounts');
  await expectMembers(page, 'Cash', ['Wallet']);
  await expectMembers(page, 'Investments', ['Broker', 'Bank']);
  await nav(page, 'Settings');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-action="exportJSON"]').click();
  const download = await downloadPromise;
  const backup = testInfo.outputPath('long-journey-backup.json');
  await download.saveAs(backup);
  const expected = JSON.parse(await readFile(backup, 'utf8'));
  expect(expected.balances).toHaveLength(6);
  await page.locator('[data-action="clearAllData"]').click();
  await page.locator('#clearDataPhrase').fill('DELETE');
  await page.locator('#clearDataAccept').click();
  await expect(page.getByText('Welcome to Capital Tracker')).toBeVisible();
  await nav(page, 'Settings');
  await page.locator('#jsonFileInput').setInputFiles(backup);
  await page.locator('#confirmAccept').click();
  await expect(page.locator('#toast')).toContainText(
    'JSON data imported successfully',
  );
  await nav(page, 'Accounts');
  await expectMembers(page, 'Cash', ['Wallet']);
  await expectMembers(page, 'Investments', ['Broker', 'Bank']);
  await expect(page.locator('.account-group.is-collapsed')).toHaveCount(0);
  await nav(page, 'Dashboard');
  await expect(page.locator('.metric').first()).toContainText('€780.00');
  await expect(page.locator('.metric').nth(1)).toContainText(
    '+€160.00 (+25.81%)',
  );
  await setMonth(page, '2025-12');
  await expect(page.locator('.metric').first()).toContainText('€620.00');
  const restored = await (
    await page.request.get(app + '/api/data/export')
  ).json();
  for (const field of [
    'accounts',
    'groups',
    'account_periods',
    'months',
    'balances',
    'rates',
  ])
    expect(restored[field]).toEqual(expected[field]);
});

test('long journey: archive, inactive months, restore, backdated protection and account history', async ({
  page,
  app,
  restartApp,
}) => {
  test.setTimeout(90000);
  await open(page, app);
  await nav(page, 'Accounts');
  await createGroup(page, 'Savings');
  await page.locator('#accountGroup').selectOption({ label: 'Savings' });
  await createAccount(page, 'Bank');
  await createAccount(page, 'Wallet');
  await nav(page, 'Monthly balances');
  await saveBalances(page, '2025-01', { 1: '100', 2: '20' });
  await saveBalances(page, '2025-02', { 1: '200', 2: '30' });
  await nav(page, 'Accounts');
  await action(page, 'Bank', 'archive');
  await editDialog(page, '2025-03');
  await expectMembers(page, 'Archive', ['Bank']);
  await page.getByRole('button', { name: 'Collapse all', exact: true }).click();
  await nav(page, 'Monthly balances');
  await page.getByRole('button', { name: 'Expand all', exact: true }).click();
  await setMonth(page, '2025-03');
  await expect(page.locator('[data-balance="1"]')).toHaveCount(0);
  await saveBalances(page, '2025-03', { 2: '40' });
  await nav(page, 'Accounts');
  await action(page, 'Bank', 'restore');
  await editDialog(page, '2025-04');
  await expectMembers(page, 'Savings', ['Bank']);
  await nav(page, 'Monthly balances');
  await setMonth(page, '2025-04');
  await expect(page.locator('[data-balance="1"]')).toHaveValue('');
  await expect(
    page.locator('[data-action="copyPrevious"][data-id="1"]'),
  ).toBeDisabled();
  await saveBalances(page, '2025-04', { 1: '300', 2: '50' });
  await restartApp();
  await page.reload();
  await nav(page, 'Accounts');
  await action(page, 'Bank', 'currency');
  await page.locator('#editValue').selectOption('USD');
  await page.locator('#confirmEdit').click();
  await expect(page.locator('#toast')).toContainText(
    'currency can no longer be changed',
  );
  await page.locator('#cancelEdit').click();
  await action(page, 'Bank', 'history');
  await expect(page.locator('#pageContent table tbody tr')).toHaveCount(3);
  await expect(page.locator('#pageContent')).toContainText('€100.00');
  await expect(page.locator('#pageContent')).toContainText('€200.00');
  await expect(page.locator('#pageContent')).toContainText('€300.00');
  await nav(page, 'Dashboard');
  await setMonth(page, '2025-02');
  await expect(page.locator('.metric').first()).toContainText('€230.00');
  await setMonth(page, '2025-03');
  await expect(page.locator('.metric').first()).toContainText('€40.00');
  await expect(page.locator('.metric').nth(1)).toContainText(
    '-€190.00 (-82.61%)',
  );
  await setMonth(page, '2025-04');
  await expect(page.locator('.metric').first()).toContainText('€350.00');
});

for (const width of [360, 390, 768]) {
  test(`bulk group controls remain usable at viewport ${width}`, async ({
    page,
    app,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await open(page, app);
    await nav(page, 'Accounts');
    await createGroup(page, 'Very long group name for narrow screens');
    for (const screen of ['Accounts', 'Monthly balances']) {
      if (screen !== 'Accounts') await nav(page, screen);
      await page
        .getByRole('button', { name: 'Collapse all', exact: true })
        .click();
      await expect(
        page.locator('.account-group:not(.is-collapsed)'),
      ).toHaveCount(0);
      await page
        .getByRole('button', { name: 'Expand all', exact: true })
        .click();
      await expect(page.locator('.account-group.is-collapsed')).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
  });
}
